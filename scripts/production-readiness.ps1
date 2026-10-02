[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$DashboardUrl = 'http://localhost:8080',
  [string]$EnvFile = '.env',
  [string]$ComposeFile = 'docker-compose.production.yml',
  [string]$ProjectName = 'repo',
  [int]$Requests = 100,
  [int]$Concurrency = 20,
  [int]$StartupTimeoutSec = 60,
  [int]$RetryDelaySec = 2,
  [switch]$IncludeCapacitySmoke,
  [int]$DurationSeconds = 30,
  [int]$CapacityConcurrency = 20,
  [int]$CapacityDelayMs = 0,
  [double]$MaxErrorRate = 0,
  [switch]$IncludeDashboardSmoke,
  [switch]$IncludeRepairAudit,
  [switch]$RequireRepairTargets,
  [switch]$RequireGitHubApp,
  [switch]$IncludeBackupRestoreDrill,
  [switch]$ConfirmDrill
)

$ErrorActionPreference = 'Stop'

if ($IncludeBackupRestoreDrill -and -not $ConfirmDrill) {
  throw 'The backup/restore drill creates and drops a temporary database. Re-run with -IncludeBackupRestoreDrill -ConfirmDrill.'
}
if ($IncludeCapacitySmoke -and ($DurationSeconds -lt 1 -or $DurationSeconds -gt 3600)) {
  throw '-DurationSeconds must be from 1 to 3600 when capacity smoke is enabled'
}
if ($IncludeCapacitySmoke -and ($CapacityConcurrency -lt 1 -or $CapacityConcurrency -gt 1000)) {
  throw '-CapacityConcurrency must be from 1 to 1000 when capacity smoke is enabled'
}
if ($IncludeCapacitySmoke -and ($CapacityDelayMs -lt 0 -or $CapacityDelayMs -gt 60000)) {
  throw '-CapacityDelayMs must be from 0 to 60000 when capacity smoke is enabled'
}
if ($IncludeCapacitySmoke -and ($MaxErrorRate -lt 0 -or $MaxErrorRate -gt 1)) {
  throw '-MaxErrorRate must be between 0 and 1 when capacity smoke is enabled'
}
if ($StartupTimeoutSec -lt 1) { throw '-StartupTimeoutSec must be positive' }
if ($RetryDelaySec -lt 1) { throw '-RetryDelaySec must be positive' }
if ($RequireRepairTargets) { $IncludeRepairAudit = $true }

function Invoke-Check([string]$Name, [scriptblock]$Command) {
  Write-Host "`n== $Name =="
  $global:LASTEXITCODE = 0
  & $Command
  $commandSucceeded = $?
  $commandExitCode = $LASTEXITCODE
  if (-not $commandSucceeded -or $commandExitCode -ne 0) {
    throw "$Name failed$(if ($commandExitCode -ne 0) { " with exit code $commandExitCode" })"
  }
}

Invoke-Check 'Stack smoke' {
  $stackSmokeParams = @{
    ApiUrl = $ApiUrl
    DashboardUrl = $DashboardUrl
    EnvFile = $EnvFile
    StartupTimeoutSec = $StartupTimeoutSec
    RetryDelaySec = $RetryDelaySec
  }
  if ($RequireGitHubApp) { $stackSmokeParams.RequireGitHubApp = $true }
  & "$PSScriptRoot\stack-smoke.ps1" @stackSmokeParams
}

Invoke-Check 'Security smoke' {
  & "$PSScriptRoot\security-smoke.ps1" -ApiUrl $ApiUrl -EnvFile $EnvFile
}

Invoke-Check 'Authenticated load smoke' {
  & node "$PSScriptRoot\load-smoke.mjs" --url $ApiUrl --env-file $EnvFile --requests $Requests --concurrency $Concurrency
}

if ($IncludeCapacitySmoke) {
  Invoke-Check 'Sustained capacity smoke' {
    & node "$PSScriptRoot\capacity-smoke.mjs" --url $ApiUrl --env-file $EnvFile --duration-seconds $DurationSeconds --concurrency $CapacityConcurrency --delay-ms $CapacityDelayMs --max-error-rate $MaxErrorRate
  }
}

if ($IncludeDashboardSmoke) {
  Invoke-Check 'Production dashboard smoke' {
    & pnpm --filter @shapi/backend exec tsx "$PSScriptRoot/../apps/backend/scripts/production-dashboard-test.ts" --dashboard-url $DashboardUrl --api-url $ApiUrl --env-file $EnvFile
  }
}

if ($IncludeRepairAudit) {
  Invoke-Check 'Repair readiness audit' {
    $auditParams = @{
      ApiUrl = $ApiUrl
      EnvFile = $EnvFile
    }
    if ($RequireRepairTargets) { $auditParams.FailOnUnready = $true }
    & "$PSScriptRoot\audit-repair-readiness.ps1" @auditParams
  }
}

if ($IncludeBackupRestoreDrill) {
  Invoke-Check 'Backup and restore drill' {
    & "$PSScriptRoot\backup-restore-drill.ps1" -EnvFile $EnvFile -ComposeFile $ComposeFile -ProjectName $ProjectName -ConfirmDrill
  }
}

Write-Host "`nProduction readiness checks passed."
