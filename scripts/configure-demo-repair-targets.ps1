[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$EnvFile = '.env',
  [string]$Repository = 'SriVarshini09/self-healing-api',
  [string]$FilePath = 'apps/backend/prisma/seed.ts',
  [string[]]$RequiredChecks = @('verify'),
  [string[]]$InvariantIds = @(
    'inv-stripe-payment-succeeded',
    'inv-stripe-subscription-active',
    'inv-stripe-refund-succeeded'
  ),
  [switch]$IncludeProvisioningAdapter,
  [switch]$IncludeSubscriptionAdapter,
  [switch]$IncludeGitHubTargets,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$([regex]::Escape($Name))=", '').Trim().Trim('"').Trim("'")
}

if ($Repository -notmatch '^[^/\s]+/[^/\s]+$') {
  throw 'Repository must be in owner/repository form'
}
if ([string]::IsNullOrWhiteSpace($FilePath) -or $FilePath -match '(^/|^[A-Za-z]:|\\|(^|/)\.\.(/|$)|(^|/)\.(/|$))') {
  throw 'FilePath must be a non-empty repository-relative POSIX path without traversal'
}
if ($RequiredChecks.Count -eq 0 -or @($RequiredChecks | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
  throw 'At least one non-empty required GitHub check is required'
}
if ($InvariantIds.Count -eq 0) { throw 'At least one invariant ID is required' }

$apiKey = Read-EnvValue -Path $EnvFile -Name 'SHAPI_API_KEY'
if (-not $apiKey) { throw "SHAPI_API_KEY was not found in $EnvFile" }

$headers = @{ 'x-api-key' = $apiKey }
$baseUrl = $ApiUrl.TrimEnd('/')
$response = Invoke-RestMethod -Uri "$baseUrl/api/v1/invariants?pageSize=100" -Headers $headers
$rows = @($response.data)
$mappingSpecs = @(
  [pscustomobject]@{
    InvariantIds = @($InvariantIds)
    FilePath = $FilePath
    RequiredChecks = @($RequiredChecks)
    ExpectedText = $null
  }
)
if ($IncludeProvisioningAdapter) {
  $provisioningBefore = @(
    '  if (failureMode) {',
    '    return {',
    '      success: false,',
    "      details: { reason: 'provisioning skipped (simulated bug)', customer },",
    '    };',
    '  }'
  ) -join "`n"
  $provisioningBefore += "`n"
  $mappingSpecs += [pscustomobject]@{
    InvariantIds = @('inv-stripe-provisioning')
    FilePath = 'apps/demo-saas/src/business-outcome.ts'
    RequiredChecks = @('verify', 'business-outcome')
    ExpectedText = $provisioningBefore
  }
}
if ($IncludeSubscriptionAdapter) {
  $subscriptionBefore = @(
    '  if (failureMode) {',
    '    return {',
    '      success: false,',
    "      details: { reason: 'subscription activation skipped (simulated bug)', customer },",
    '    };',
    '  }'
  ) -join "`n"
  $subscriptionBefore += "`n"
  $mappingSpecs += [pscustomobject]@{
    InvariantIds = @('inv-stripe-subscription-activation')
    FilePath = 'apps/demo-saas/src/subscription-outcome.ts'
    RequiredChecks = @('verify', 'business-outcome')
    ExpectedText = $subscriptionBefore
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
if ($IncludeGitHubTargets) {
  $githubPredicateFile = 'apps/backend/src/services/github-invariants.ts'
  $mappingSpecs += @(
    [pscustomobject]@{
      InvariantIds = @('inv-github-pr-merged')
      FilePath = $githubPredicateFile
      RequiredChecks = @('verify')
      ExpectedText = "event.type === 'pull_request' && event.payload?.action === 'closed' && event.payload?.pull_request?.merged === true && event.payload?.pull_request?.base?.ref === 'main'"
    },
    [pscustomobject]@{
      InvariantIds = @('inv-github-workflow-success')
      FilePath = $githubPredicateFile
      RequiredChecks = @('verify')
      ExpectedText = "event.type === 'workflow_run' && event.payload?.action === 'completed' && event.payload?.workflow_run?.conclusion === 'success'"
    }
  )
}

foreach ($spec in $mappingSpecs) {
  $targetFile = Join-Path $repoRoot $spec.FilePath
  if (-not (Test-Path -LiteralPath $targetFile)) { throw "Target file was not found locally: $targetFile" }
  $source = Get-Content -LiteralPath $targetFile -Raw
  foreach ($id in $spec.InvariantIds) {
    $invariant = $rows | Where-Object { $_.id -eq $id } | Select-Object -First 1
    if (-not $invariant) { throw "Invariant was not found for the authenticated tenant: $id" }
    $expectedText = if ($null -ne $spec.ExpectedText) { [string]$spec.ExpectedText } else { [string]$invariant.predicateExpression }
    $occurrences = [regex]::Matches($source, [regex]::Escape($expectedText)).Count
    if ($occurrences -ne 1) {
      throw "Target precondition for $id must occur exactly once in $($spec.FilePath); found $occurrences occurrences"
    }

    $body = @{
      repairRepository = $Repository
      repairFilePath = $spec.FilePath
      repairRequiredChecks = @($spec.RequiredChecks)
    } | ConvertTo-Json -Compress

    if ($Apply) {
      $updated = Invoke-RestMethod -Method Patch -Uri "$baseUrl/api/v1/invariants/$id" -Headers $headers -ContentType 'application/json' -Body $body
      if ($updated.repairRepository -ne $Repository -or $updated.repairFilePath -ne $spec.FilePath) {
        throw "API did not persist the expected target for $id"
      }
      $actualChecks = @($updated.repairRequiredChecks)
      if ((Compare-Object -ReferenceObject @($spec.RequiredChecks) -DifferenceObject $actualChecks)) {
        throw "API did not persist the expected required checks for $id"
      }
      Write-Output "Mapped $id -> $Repository/$($spec.FilePath) (checks: $($spec.RequiredChecks -join ', '))"
    } else {
      Write-Output "Would map $id -> $Repository/$($spec.FilePath) (checks: $($spec.RequiredChecks -join ', '))"
    }
  }
}

if (-not $Apply) {
  Write-Output 'Dry run only. Re-run with -Apply to persist these reviewed mappings.'
}
