[CmdletBinding()]
param(
  [string]$EnvFile = '.env',
  [string]$ComposeFile = 'docker-compose.production.yml',
  [string]$ProjectName = 'repo',
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$DashboardUrl = 'http://localhost:8080',
  [int]$StartupTimeoutSec = 180,
  [int]$Requests = 100,
  [int]$Concurrency = 20,
  [switch]$NoBuild,
  [switch]$RequireGitHubApp,
  [switch]$IncludeDashboardSmoke,
  [switch]$IncludeGitHubWebhookSmoke,
  [switch]$IncludeRepairAudit,
  [switch]$RequireRepairTargets,
  [switch]$IncludeCapacitySmoke,
  [int]$DurationSeconds = 30,
  [int]$CapacityConcurrency = 20,
  [int]$CapacityDelayMs = 0,
  [double]$MaxErrorRate = 0,
  [switch]$IncludeBackupRestoreDrill,
  [switch]$ConfirmDrill
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'http-request-compat.ps1')

if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Environment file not found: $EnvFile" }
if (-not (Test-Path -LiteralPath $ComposeFile)) { throw "Compose file not found: $ComposeFile" }
& "$PSScriptRoot\validate-env.ps1" -EnvFile $EnvFile
if ($StartupTimeoutSec -lt 1) { throw '-StartupTimeoutSec must be positive' }
if ($IncludeBackupRestoreDrill -and -not $ConfirmDrill) {
  throw 'The backup/restore drill creates and drops a temporary database. Re-run with -IncludeBackupRestoreDrill -ConfirmDrill.'
}

$composePrefix = @('compose', '--env-file', $EnvFile, '-f', $ComposeFile, '-p', $ProjectName)

function Invoke-Compose([string[]]$Arguments) {
  & docker @composePrefix @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

function Test-Endpoint([string]$Uri) {
  try {
    $response = Invoke-HttpRequestCompat -Parameters @{
      Uri = $Uri
      UseBasicParsing = $true
      SkipHttpErrorCheck = $true
      TimeoutSec = 5
    }
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
  } catch {
    return $false
  }
}

Write-Host 'Validating rendered production Compose configuration...'
Invoke-Compose @('config', '--quiet')

try {
  $upArgs = @('up', '-d')
  if (-not $NoBuild) { $upArgs += '--build' }
  Write-Host 'Starting production services...'
  Invoke-Compose $upArgs

  $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
  do {
    $apiReady = Test-Endpoint "$($ApiUrl.TrimEnd('/'))/ready"
    $dashboardReady = Test-Endpoint "$($DashboardUrl.TrimEnd('/'))/"
    if ($apiReady -and $dashboardReady) { break }
    if ((Get-Date) -ge $deadline) {
      throw "Services did not become ready within $StartupTimeoutSec seconds"
    }
    Start-Sleep -Seconds 5
  } while ($true)

  Write-Host 'Services are ready; running production readiness checks...'
  $readinessScript = "$PSScriptRoot\production-readiness.ps1"
  $readinessParams = @{
    ApiUrl = $ApiUrl
    DashboardUrl = $DashboardUrl
    EnvFile = $EnvFile
    ComposeFile = $ComposeFile
    ProjectName = $ProjectName
    Requests = $Requests
    Concurrency = $Concurrency
  }
  if ($RequireGitHubApp) { $readinessParams.RequireGitHubApp = $true }
  if ($IncludeDashboardSmoke) { $readinessParams.IncludeDashboardSmoke = $true }
  if ($IncludeGitHubWebhookSmoke) { $readinessParams.IncludeGitHubWebhookSmoke = $true }
  if ($IncludeRepairAudit) { $readinessParams.IncludeRepairAudit = $true }
  if ($RequireRepairTargets) { $readinessParams.RequireRepairTargets = $true }
  if ($IncludeCapacitySmoke) {
    $readinessParams.IncludeCapacitySmoke = $true
    $readinessParams.DurationSeconds = $DurationSeconds
    $readinessParams.CapacityConcurrency = $CapacityConcurrency
    $readinessParams.CapacityDelayMs = $CapacityDelayMs
    $readinessParams.MaxErrorRate = $MaxErrorRate
  }
  if ($IncludeBackupRestoreDrill) {
    $readinessParams.IncludeBackupRestoreDrill = $true
    $readinessParams.ConfirmDrill = $true
  }
  & $readinessScript @readinessParams
  $readinessSucceeded = $?
  $readinessExitCode = $LASTEXITCODE
  if (-not $readinessSucceeded -or $readinessExitCode -ne 0) {
    throw "Production readiness checks failed$(if ($readinessExitCode -ne 0) { " with exit code $readinessExitCode" })"
  }
} catch {
  Write-Warning "Production deployment verification failed: $($_.Exception.Message)"
  Write-Host 'Service status:'
  & docker @composePrefix ps
  Write-Host 'Recent backend logs (last 100 lines):'
  & docker @composePrefix logs --no-color --tail 100 backend
  throw
}

Write-Host "`nProduction deployment completed and passed readiness checks."
