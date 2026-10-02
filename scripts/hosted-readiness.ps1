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
  # Retained for command-line compatibility; the audit is now always included.
  [switch]$IncludeRepairAudit,
  [switch]$RequireRepairTargets
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
