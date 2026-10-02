[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,
  [Parameter(Mandatory = $true)]
  [string]$DashboardUrl,
  [Parameter(Mandatory = $true)]
  [string]$EnvFile,
  [int]$Requests = 20,
  [int]$Concurrency = 5,
  [switch]$IncludeCapacitySmoke,
  [int]$DurationSeconds = 30,
  [int]$CapacityConcurrency = 1,
  [int]$CapacityDelayMs = 250,
  [double]$MaxErrorRate = 0,
  [switch]$RequireGitHubApp = $true,
  [switch]$IncludeDashboardSmoke = $true,
  [switch]$IncludeGitHubWebhookSmoke = $true,
  # Retained for command-line compatibility; the audit is now always included.
  [switch]$IncludeRepairAudit,
  [switch]$RequireRepairTargets,
  [switch]$RequireOidc,
  # A hosted release is not usable if the dashboard has neither an API-key
  # runtime configuration nor an enabled OIDC provider. Keep this check on by
  # default; callers can explicitly disable it for infrastructure-only trials.
  [switch]$RequireDashboardAuthentication = $true
)

$ErrorActionPreference = 'Stop'

function Assert-PublicHttpsUrl([string]$Name, [string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne 'https') {
    throw "$Name must be an absolute HTTPS URL for hosted readiness checks: $Value"
  }
  if ($parsed.Host -in @('localhost', '127.0.0.1', '::1')) {
    throw "$Name must point to a hosted public endpoint, not $($parsed.Host)"
  }
}

if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Environment file not found: $EnvFile" }
Assert-PublicHttpsUrl 'ApiUrl' $ApiUrl
Assert-PublicHttpsUrl 'DashboardUrl' $DashboardUrl

Write-Host 'Running credential-free hosted infrastructure checks...'
& "$PSScriptRoot\hosted-infrastructure-smoke.ps1" `
  -ApiUrl $ApiUrl `
  -DashboardUrl $DashboardUrl

if ($RequireDashboardAuthentication) {
  $runtimeConfigResponse = Invoke-WebRequest `
    -Method GET `
    -Uri "$($DashboardUrl.TrimEnd('/'))/config.js" `
    -UseBasicParsing `
    -SkipHttpErrorCheck `
    -TimeoutSec 15
  if ([int]$runtimeConfigResponse.StatusCode -ne 200) {
    throw "Hosted dashboard runtime configuration is unavailable (HTTP $($runtimeConfigResponse.StatusCode))."
  }

  # The dashboard entrypoint writes the API key as base64 in config.js. Only
  # inspect whether the encoded value is empty; never decode or print it.
  $apiKeyMatch = [regex]::Match(
    [string]$runtimeConfigResponse.Content,
    'apiKey:\s*atob\("(?<value>[^"]*)"\)',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  $dashboardApiKeyConfigured = $apiKeyMatch.Success -and $apiKeyMatch.Groups['value'].Value.Length -gt 0

  $authConfigResponse = Invoke-WebRequest `
    -Method GET `
    -Uri "$($ApiUrl.TrimEnd('/'))/api/v1/auth/config" `
    -UseBasicParsing `
    -SkipHttpErrorCheck `
    -TimeoutSec 15
  if ([int]$authConfigResponse.StatusCode -ne 200) {
    throw "Hosted API authentication configuration is unavailable (HTTP $($authConfigResponse.StatusCode))."
  }
  try {
    $authConfig = $authConfigResponse.Content | ConvertFrom-Json
  } catch {
    throw 'Hosted API authentication configuration returned invalid JSON.'
  }
  $oidcConfigured = [bool]$authConfig.oidcEnabled

  if (-not $dashboardApiKeyConfigured -and -not $oidcConfigured) {
    throw 'Hosted dashboard authentication is not configured: set VITE_SHAPI_API_KEY to the scoped dashboard key or enable complete OIDC configuration before release.'
  }
  if ($dashboardApiKeyConfigured) {
    Write-Host 'PASS hosted dashboard authentication configuration (runtime API key present; value omitted)'
  } else {
    Write-Host 'PASS hosted dashboard authentication configuration (OIDC enabled)'
  }
}

$envValidationParams = @{ EnvFile = $EnvFile }
if ($RequireGitHubApp) { $envValidationParams.RequireGitHubApp = $true }
if ($RequireOidc) { $envValidationParams.RequireOidc = $true }
& "$PSScriptRoot\validate-hosted-env.ps1" @envValidationParams
if ($LASTEXITCODE -ne 0) { throw "Hosted environment preflight failed with exit code $LASTEXITCODE" }

$readinessScript = Join-Path $PSScriptRoot 'production-readiness.ps1'
$readinessParams = @{
  ApiUrl = $ApiUrl
  DashboardUrl = $DashboardUrl
  EnvFile = $EnvFile
  Requests = $Requests
  Concurrency = $Concurrency
}
if ($RequireGitHubApp) { $readinessParams.RequireGitHubApp = $true }
if ($IncludeDashboardSmoke) { $readinessParams.IncludeDashboardSmoke = $true }
# Hosted readiness must prove the public signed webhook path, not only API and
# dashboard reachability. The smoke uses a harmless ping and verifies replay
# deduplication with the same delivery id.
if ($IncludeGitHubWebhookSmoke) { $readinessParams.IncludeGitHubWebhookSmoke = $true }
# Hosted readiness always reports repair coverage. The audit is read-only and
# remains informational unless -RequireRepairTargets is explicitly supplied.
$readinessParams.IncludeRepairAudit = $true
if ($RequireRepairTargets) { $readinessParams.RequireRepairTargets = $true }
if ($IncludeCapacitySmoke) {
  $readinessParams.IncludeCapacitySmoke = $true
  $readinessParams.DurationSeconds = $DurationSeconds
  $readinessParams.CapacityConcurrency = $CapacityConcurrency
  $readinessParams.CapacityDelayMs = $CapacityDelayMs
  $readinessParams.MaxErrorRate = $MaxErrorRate
}

Write-Host "Running hosted readiness checks against $ApiUrl and $DashboardUrl..."
& $readinessScript @readinessParams
if ($LASTEXITCODE -ne 0) { throw "Hosted readiness checks failed with exit code $LASTEXITCODE" }
