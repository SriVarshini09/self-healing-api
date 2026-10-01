param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$EnvFile = '.env',
  [string]$ComposeFile = 'docker-compose.production.yml',
  [string]$ProjectName = 'repo',
  [string]$Database = 'shapi',
  [string]$Username = '',
  [switch]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) {
  throw 'Restore is destructive. Re-run with -ConfirmRestore after taking a fresh backup.'
}
$envLine = if (Test-Path -LiteralPath $EnvFile) {
  Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match '^POSTGRES_USER=(.*)$' } | Select-Object -First 1
} else { $null }
if (-not $Username -and $envLine) { $Username = ($envLine -replace '^POSTGRES_USER=', '').Trim().Trim('"') }
if (-not $Username) { throw "POSTGRES_USER is required; pass -Username or provide it in $EnvFile" }

$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile -ErrorAction Stop).Path

$dockerArgs = @(
  'compose', '--env-file', $EnvFile, '-f', $ComposeFile, '-p', $ProjectName,
  'exec', '-T', 'postgres', 'psql', '--username', $Username, '--dbname', $Database,
  '-v', 'ON_ERROR_STOP=1'
)
Get-Content -LiteralPath $resolvedBackup -Raw | & docker @dockerArgs
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL restore failed with exit code $LASTEXITCODE"
}

Write-Output "Restore completed from $resolvedBackup"
