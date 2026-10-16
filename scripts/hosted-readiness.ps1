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
  # A hosted release must let people sign in (password or OIDC) and must NOT publish
  # an API key in the dashboard's public runtime config. Keep this check on by
  # default; callers can explicitly disable it for infrastructure-only trials.
  [switch]$RequireDashboardAuthentication = $true,
  # Only for deliberately key-only, private-network dashboards.
  [switch]$AllowPublicDashboardKey
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'http-request-compat.ps1')

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
  $runtimeConfigResponse = Invoke-HttpRequestCompat -Parameters @{
    Method = 'GET'
    Uri = "$($DashboardUrl.TrimEnd('/'))/config.js"
    UseBasicParsing = $true
    SkipHttpErrorCheck = $true
    TimeoutSec = 15
  }
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

  $authConfigResponse = Invoke-HttpRequestCompat -Parameters @{
    Method = 'GET'
    Uri = "$($ApiUrl.TrimEnd('/'))/api/v1/auth/config"
    UseBasicParsing = $true
    SkipHttpErrorCheck = $true
    TimeoutSec = 15
  }
  if ([int]$authConfigResponse.StatusCode -ne 200) {
    throw "Hosted API authentication configuration is unavailable (HTTP $($authConfigResponse.StatusCode))."
  }
  try {
    $authConfig = $authConfigResponse.Content | ConvertFrom-Json
  } catch {
    throw 'Hosted API authentication configuration returned invalid JSON.'
  }
  $oidcConfigured = [bool]$authConfig.oidcEnabled
  $passwordConfigured = $authConfig.passwordLogin -ne $false

  # The runtime config is a public file. A key in it is readable by anyone and makes the
  # dashboard skip sign-in, so it fails the release unless explicitly allowed.
  if ($dashboardApiKeyConfigured -and -not $AllowPublicDashboardKey) {
    throw 'The hosted dashboard publishes an API key in its public config.js (value omitted). Remove VITE_SHAPI_API_KEY from the dashboard service and rotate that key; anyone can read it and the sign-in page is bypassed.'
  }
  if (-not $dashboardApiKeyConfigured -and -not $oidcConfigured -and -not $passwordConfigured) {
    throw 'Hosted dashboard sign-in is not available: enable password sign-in or complete OIDC configuration before release.'
  }
  if ($dashboardApiKeyConfigured) {
    Write-Host 'WARN hosted dashboard publishes an API key (allowed by -AllowPublicDashboardKey; value omitted)'
  } else {
    Write-Host 'PASS hosted dashboard authentication configuration (no key published; sign-in via session)'
  }
}

$envValidationParams = @{ EnvFile = $EnvFile }
# The GitHub App id, slug, and private key belong to the hosted API service,
# not to this operator file. The live stack/production checks below validate
# the running API's App mode and credentials without copying private material
# onto the operator machine.
if ($RequireOidc) { $envValidationParams.RequireOidc = $true }
& "$PSScriptRoot\validate-hosted-env.ps1" @envValidationParams

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
