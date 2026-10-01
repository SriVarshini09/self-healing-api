param(
  [string]$EnvFile = '.env',
  [string]$ComposeFile = 'docker-compose.production.yml',
  [string]$ProjectName = 'repo',
  [string]$Database = 'shapi',
  [string]$Username = '',
  [string]$OutputDirectory = 'backups'
)

$ErrorActionPreference = 'Stop'
$envLine = if (Test-Path -LiteralPath $EnvFile) {
  Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match '^POSTGRES_USER=(.*)$' } | Select-Object -First 1
} else { $null }
if (-not $Username -and $envLine) { $Username = ($envLine -replace '^POSTGRES_USER=', '').Trim().Trim('"') }
if (-not $Username) { throw "POSTGRES_USER is required; pass -Username or provide it in $EnvFile" }

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = Join-Path $resolvedOutput "shapi-$stamp.sql"

$dockerArgs = @(
  'compose', '--env-file', $EnvFile, '-f', $ComposeFile, '-p', $ProjectName,
  'exec', '-T', 'postgres', 'pg_dump', '--username', $Username, '--dbname', $Database,
  '--clean', '--if-exists', '--no-owner', '--no-privileges'
)
& docker @dockerArgs | Set-Content -LiteralPath $backupFile -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
  throw "PostgreSQL backup failed with exit code $LASTEXITCODE"
}

Write-Output "Backup written to $backupFile"
