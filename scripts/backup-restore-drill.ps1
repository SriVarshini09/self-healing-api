[CmdletBinding()]
param(
  [string]$EnvFile = '.env',
  [string]$ComposeFile = 'docker-compose.production.yml',
  [string]$ProjectName = 'repo',
  [string]$Database = 'shapi',
  [string]$Username = '',
  [switch]$ConfirmDrill
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmDrill) {
  throw 'The restore drill creates and drops a temporary database. Re-run with -ConfirmDrill.'
}

if (-not $Username) {
  $envLine = if (Test-Path -LiteralPath $EnvFile) {
    Get-Content -LiteralPath $EnvFile |
      Where-Object { $_ -match '^POSTGRES_USER=(.*)$' } |
      Select-Object -First 1
  } else { $null }
  if ($envLine) { $Username = ($envLine -replace '^POSTGRES_USER=', '').Trim().Trim('"') }
}
if (-not $Username) { throw 'POSTGRES_USER is required; pass -Username or provide it in the env file' }

$drillId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$temporaryDatabase = "shapi_restore_drill_$drillId"
$outputDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "shapi-backup-restore-drill-$drillId"
$temporaryDatabaseCreated = $false

function Invoke-ComposePsql([string]$TargetDatabase, [string]$Sql) {
  $dockerArgs = @(
    'compose', '--env-file', $EnvFile, '-f', $ComposeFile, '-p', $ProjectName,
    'exec', '-T', 'postgres', 'psql', '--username', $Username, '--dbname', $TargetDatabase,
    '-v', 'ON_ERROR_STOP=1', '-At', '-c', $Sql
  )
  $result = & docker @dockerArgs
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL command failed for database '$TargetDatabase'" }
  return ($result | Out-String).Trim()
}

try {
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  & "$PSScriptRoot\backup-db.ps1" -EnvFile $EnvFile -ComposeFile $ComposeFile -ProjectName $ProjectName -Database $Database -Username $Username -OutputDirectory $outputDirectory
  $backup = Get-ChildItem -LiteralPath $outputDirectory -Filter '*.sql' | Select-Object -First 1
  if (-not $backup) { throw 'Backup runbook did not produce a SQL file' }

  Invoke-ComposePsql 'postgres' "CREATE DATABASE $temporaryDatabase OWNER $Username;" | Out-Null
  $temporaryDatabaseCreated = $true
  & "$PSScriptRoot\restore-db.ps1" -BackupFile $backup.FullName -EnvFile $EnvFile -ComposeFile $ComposeFile -ProjectName $ProjectName -Database $temporaryDatabase -Username $Username -ConfirmRestore

  $countQuery = @'
SELECT 'Tenant', COUNT(*) FROM "Tenant"
UNION ALL SELECT 'Integration', COUNT(*) FROM "Integration"
UNION ALL SELECT 'Incident', COUNT(*) FROM "Incident"
UNION ALL SELECT 'AlertDelivery', COUNT(*) FROM "AlertDelivery"
UNION ALL SELECT 'WebhookEvent', COUNT(*) FROM "WebhookEvent"
UNION ALL SELECT 'TrackedEvent', COUNT(*) FROM "TrackedEvent"
ORDER BY 1;
'@
  $liveCounts = Invoke-ComposePsql $Database $countQuery
  $restoredCounts = Invoke-ComposePsql $temporaryDatabase $countQuery
  if ($liveCounts -ne $restoredCounts) {
    throw "Restore verification failed: live and restored row counts differ`nLIVE:`n$liveCounts`nRESTORED:`n$restoredCounts"
  }
  Write-Output "Backup/restore drill passed for $Database; verified row counts in $temporaryDatabase."
}
finally {
  if ($temporaryDatabaseCreated) {
    try { Invoke-ComposePsql 'postgres' "DROP DATABASE $temporaryDatabase;" | Out-Null } catch { Write-Warning "Could not drop temporary database ${temporaryDatabase}: $($_.Exception.Message)" }
  }
  if (Test-Path -LiteralPath $outputDirectory) {
    $backupFiles = Get-ChildItem -LiteralPath $outputDirectory -File -Force -ErrorAction SilentlyContinue
    foreach ($file in $backupFiles) { [System.IO.File]::Delete($file.FullName) }
    if ((Get-ChildItem -LiteralPath $outputDirectory -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
      [System.IO.Directory]::Delete($outputDirectory)
    }
  }
}
