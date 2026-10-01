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
  [switch]$IncludeBackupRestoreDrill,
  [switch]$ConfirmDrill
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Environment file not found: $EnvFile" }
if (-not (Test-Path -LiteralPath $ComposeFile)) { throw "Compose file not found: $ComposeFile" }
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
    $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 5
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
  if ($RequireGitHubApp -and $IncludeBackupRestoreDrill) {
    & $readinessScript -ApiUrl $ApiUrl -DashboardUrl $DashboardUrl -EnvFile $EnvFile -ComposeFile $ComposeFile -ProjectName $ProjectName -Requests $Requests -Concurrency $Concurrency -RequireGitHubApp -IncludeBackupRestoreDrill -ConfirmDrill
  } elseif ($RequireGitHubApp) {
    & $readinessScript -ApiUrl $ApiUrl -DashboardUrl $DashboardUrl -EnvFile $EnvFile -ComposeFile $ComposeFile -ProjectName $ProjectName -Requests $Requests -Concurrency $Concurrency -RequireGitHubApp
  } elseif ($IncludeBackupRestoreDrill) {
    & $readinessScript -ApiUrl $ApiUrl -DashboardUrl $DashboardUrl -EnvFile $EnvFile -ComposeFile $ComposeFile -ProjectName $ProjectName -Requests $Requests -Concurrency $Concurrency -IncludeBackupRestoreDrill -ConfirmDrill
  } else {
    & $readinessScript -ApiUrl $ApiUrl -DashboardUrl $DashboardUrl -EnvFile $EnvFile -ComposeFile $ComposeFile -ProjectName $ProjectName -Requests $Requests -Concurrency $Concurrency
  }
  if (-not $?) { throw 'Production readiness checks failed' }
} catch {
  Write-Warning "Production deployment verification failed: $($_.Exception.Message)"
  Write-Host 'Service status:'
  & docker @composePrefix ps
  Write-Host 'Recent backend logs (last 100 lines):'
  & docker @composePrefix logs --no-color --tail 100 backend
  throw
}

Write-Host "`nProduction deployment completed and passed readiness checks."
