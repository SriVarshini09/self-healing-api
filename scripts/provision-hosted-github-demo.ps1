[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,
  [Parameter(Mandatory = $true)]
  [string]$EnvFile,
  [string]$IntegrationName = 'SHAPI Self-Healing GitHub App',
  [string]$AppSlug = 'shapi-self-healing',
  [string]$Repository = 'SriVarshini09/self-healing-api',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'http-request-compat.ps1')

function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Environment file not found: $Path"
  }
  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$([regex]::Escape($Name))=", '').Trim().Trim('"').Trim("'")
}

function Assert-PublicHttpsUrl([string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne 'https') {
    throw "ApiUrl must be an absolute HTTPS URL for hosted onboarding: $Value"
  }
  if ($parsed.Host -in @('localhost', '127.0.0.1', '::1')) {
    throw "ApiUrl must point to a hosted public endpoint, not $($parsed.Host)"
  }
  if (-not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw 'ApiUrl must not contain credentials'
  }
}

function Invoke-Json([string]$Method, [string]$Uri, [hashtable]$Headers, [object]$Body = $null) {
  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    UseBasicParsing = $true
    SkipHttpErrorCheck = $true
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = $Body | ConvertTo-Json -Depth 10 -Compress
  }
  $response = Invoke-HttpRequestCompat -Parameters $params
  $parsed = $null
  if ($response.Content) {
    try { $parsed = $response.Content | ConvertFrom-Json } catch { $parsed = $null }
  }
  return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $parsed }
}

function Assert-Repository([string]$Value) {
  if ($Value -notmatch '^[^/\s]+/[^/\s]+$') {
    throw 'Repository must be in owner/repository form'
  }
}

Assert-PublicHttpsUrl $ApiUrl
Assert-Repository $Repository
if ([string]::IsNullOrWhiteSpace($IntegrationName)) { throw 'IntegrationName must not be empty' }
if ($AppSlug -notmatch '^[A-Za-z0-9][A-Za-z0-9-]{0,99}$') { throw 'AppSlug contains invalid characters' }

$apiKey = Read-EnvValue -Path $EnvFile -Name 'SHAPI_API_KEY'
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "SHAPI_API_KEY was not found in $EnvFile"
}

$baseUrl = $ApiUrl.TrimEnd('/')
$headers = @{ 'x-api-key' = $apiKey }
$githubPredicateFile = 'apps/backend/src/services/github-invariants.ts'
$specs = @(
  [ordered]@{
    name = 'PR Merged Invariant'
    description = 'Pull request merged events should have merged = true and base branch = main'
    predicateExpression = "event.type === 'pull_request' && event.payload?.action === 'closed' && event.payload?.pull_request?.merged === true && event.payload?.pull_request?.base?.ref === 'main'"
    predicateDescription = 'Merged PRs should be closed with merged=true targeting main'
    predicateExample = "event.type === 'pull_request' && event.payload.action === 'closed' && event.payload.pull_request.merged === true"
    repairFilePath = $githubPredicateFile
    evaluationWindowSec = 300
    minSamples = 5
    expectedSuccessRate = 0.99
  }
  [ordered]@{
    name = 'Workflow Success Invariant'
    description = 'Workflow run completed events should have conclusion = success'
    predicateExpression = "event.type === 'workflow_run' && event.payload?.action === 'completed' && event.payload?.workflow_run?.conclusion === 'success'"
    predicateDescription = 'CI/CD workflows should complete successfully'
    predicateExample = "event.type === 'workflow_run' && event.payload.action === 'completed' && event.payload.workflow_run.conclusion === 'success'"
    repairFilePath = $githubPredicateFile
    evaluationWindowSec = 600
    minSamples = 10
    expectedSuccessRate = 0.9
  }
)

$integrationsResponse = Invoke-Json 'GET' "$baseUrl/api/v1/integrations?pageSize=100&type=GITHUB" $headers
if ($integrationsResponse.Status -ne 200) { throw "Could not list hosted GitHub integrations (HTTP $($integrationsResponse.Status))" }
$integration = @($integrationsResponse.Body.data | Select-Object -First 1)
if (-not $integration) {
  if ($DryRun) {
    Write-Output "Would create GitHub integration '$IntegrationName' for App '$AppSlug'."
  } else {
    $createdIntegration = Invoke-Json 'POST' "$baseUrl/api/v1/integrations" $headers ([ordered]@{
      name = $IntegrationName
      type = 'GITHUB'
      config = @{ appSlug = $AppSlug }
      webhookEnabled = $true
    })
    if ($createdIntegration.Status -ne 201) { throw "GitHub integration creation failed (HTTP $($createdIntegration.Status))" }
    $integration = $createdIntegration.Body
    Write-Output "Created GitHub integration: $($integration.id) (webhook secret configured; value omitted)."
  }
} else {
  Write-Output "GitHub integration already exists: $($integration.id)."
}

if ($DryRun) {
  foreach ($spec in $specs) {
    Write-Output "Would ensure invariant '$($spec.name)' -> $Repository/$githubPredicateFile (checks: verify)."
  }
  Write-Output 'Dry run only. No hosted records were changed.'
  exit 0
}

$invariantsResponse = Invoke-Json 'GET' "$baseUrl/api/v1/invariants?pageSize=100" $headers
if ($invariantsResponse.Status -ne 200) { throw "Could not list hosted invariants (HTTP $($invariantsResponse.Status))" }
$existingNames = @($invariantsResponse.Body.data | ForEach-Object name)
foreach ($spec in $specs) {
  if ($existingNames -contains $spec.name) {
    Write-Output "Invariant already exists: $($spec.name)."
    continue
  }
  $payload = [ordered]@{
    integrationId = $integration.id
    name = $spec.name
    description = $spec.description
    predicateExpression = $spec.predicateExpression
    predicateDescription = $spec.predicateDescription
    predicateExample = $spec.predicateExample
    repairRepository = $Repository
    repairFilePath = $spec.repairFilePath
    repairRequiredChecks = @('verify')
    evaluationWindowSec = $spec.evaluationWindowSec
    minSamples = $spec.minSamples
    expectedSuccessRate = $spec.expectedSuccessRate
  }
  $createdInvariant = Invoke-Json 'POST' "$baseUrl/api/v1/invariants" $headers $payload
  if ($createdInvariant.Status -ne 201) { throw "Invariant creation failed for '$($spec.name)' (HTTP $($createdInvariant.Status))" }
  Write-Output "Created invariant: $($createdInvariant.Body.id) ($($spec.name)); readiness: $($createdInvariant.Body.repairReadiness.state)."
}

$finalResponse = Invoke-Json 'GET' "$baseUrl/api/v1/invariants?pageSize=100" $headers
if ($finalResponse.Status -ne 200) { throw "Could not verify hosted invariants (HTTP $($finalResponse.Status))" }
$finalRows = @($finalResponse.Body.data | Where-Object { $_.name -in @($specs | ForEach-Object name) })
if ($finalRows.Count -ne $specs.Count) { throw "Hosted GitHub demo invariant verification found $($finalRows.Count) of $($specs.Count) expected rows" }
foreach ($row in $finalRows) {
  if ($row.repairRepository -ne $Repository -or $row.repairFilePath -ne $githubPredicateFile -or @($row.repairRequiredChecks) -notcontains 'verify') {
    throw "Hosted invariant '$($row.name)' does not have the reviewed repair target or required check"
  }
}
Write-Output "Hosted GitHub demo provisioning verified: $($finalRows.Count) reviewed invariants ready for target review."
