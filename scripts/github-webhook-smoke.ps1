[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [Parameter(Mandatory = $true)]
  [string]$EnvFile
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'github-webhook-smoke.mjs'
& node $scriptPath --api-url $ApiUrl --env-file $EnvFile
if ($LASTEXITCODE -ne 0) {
  throw "GitHub webhook smoke check failed with exit code $LASTEXITCODE"
}
