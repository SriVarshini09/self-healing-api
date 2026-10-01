[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$DashboardUrl = 'http://localhost:8080',
  [string]$EnvFile = '.env',
  [string]$ComposeFile = 'docker-compose.production.yml',
  [string]$ProjectName = 'repo',
  [int]$Requests = 100,
  [int]$Concurrency = 20,
  [switch]$RequireGitHubApp,
  [switch]$IncludeBackupRestoreDrill,
  [switch]$ConfirmDrill
)

$ErrorActionPreference = 'Stop'

if ($IncludeBackupRestoreDrill -and -not $ConfirmDrill) {
  throw 'The backup/restore drill creates and drops a temporary database. Re-run with -IncludeBackupRestoreDrill -ConfirmDrill.'
}

function Invoke-Check([string]$Name, [scriptblock]$Command) {
  Write-Host "`n== $Name =="
  & $Command
  if (-not $?) { throw "$Name failed" }
}

Invoke-Check 'Stack smoke' {
  if ($RequireGitHubApp) {
    & "$PSScriptRoot\stack-smoke.ps1" -ApiUrl $ApiUrl -DashboardUrl $DashboardUrl -EnvFile $EnvFile -RequireGitHubApp
  } else {
    & "$PSScriptRoot\stack-smoke.ps1" -ApiUrl $ApiUrl -DashboardUrl $DashboardUrl -EnvFile $EnvFile
  }
}

Invoke-Check 'Security smoke' {
  & "$PSScriptRoot\security-smoke.ps1" -ApiUrl $ApiUrl -EnvFile $EnvFile
}

Invoke-Check 'Authenticated load smoke' {
  & node "$PSScriptRoot\load-smoke.mjs" --url $ApiUrl --env-file $EnvFile --requests $Requests --concurrency $Concurrency
}

if ($IncludeBackupRestoreDrill) {
  Invoke-Check 'Backup and restore drill' {
    & "$PSScriptRoot\backup-restore-drill.ps1" -EnvFile $EnvFile -ComposeFile $ComposeFile -ProjectName $ProjectName -ConfirmDrill
  }
}

Write-Host "`nProduction readiness checks passed."
