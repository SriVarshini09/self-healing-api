param(
  [string]$EnvFile = '.env',
  [string]$ComposeFile = 'docker-compose.production.yml',
  [string]$ProjectName = 'repo',
  [string]$Database = 'shapi',
  [string]$OutputDirectory = 'backups'
)

$ErrorActionPreference = 'Stop'
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = Join-Path $resolvedOutput "shapi-$stamp.sql"

$dockerArgs = @(
  'compose', '--env-file', $EnvFile, '-f', $ComposeFile, '-p', $ProjectName,
  'exec', '-T', 'postgres', 'pg_dump', '--clean', '--if-exists', '--no-owner', '--no-privileges', $Database
)
& docker @dockerArgs | Set-Content -LiteralPath $backupFile -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
  throw "PostgreSQL backup failed with exit code $LASTEXITCODE"
}

Write-Output "Backup written to $backupFile"
