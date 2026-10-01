param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$EnvFile = '.env',
  [string]$ComposeFile = 'docker-compose.production.yml',
  [string]$ProjectName = 'repo',
  [string]$Database = 'shapi',
  [switch]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) {
  throw 'Restore is destructive. Re-run with -ConfirmRestore after taking a fresh backup.'
}
$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile -ErrorAction Stop).Path

$dockerArgs = @(
  'compose', '--env-file', $EnvFile, '-f', $ComposeFile, '-p', $ProjectName,
  'exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', $Database
)
Get-Content -LiteralPath $resolvedBackup -Raw | & docker @dockerArgs
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL restore failed with exit code $LASTEXITCODE"
}

Write-Output "Restore completed from $resolvedBackup"
