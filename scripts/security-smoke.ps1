[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$EnvFile = '.env'
)

$ErrorActionPreference = 'Stop'

function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$([regex]::Escape($Name))=", '').Trim().Trim('"')
}

function Assert-Status([string]$Name, [string]$Uri, [int]$Expected, [hashtable]$Headers = @{}) {
  $response = Invoke-WebRequest -Uri $Uri -Headers $Headers -UseBasicParsing -SkipHttpErrorCheck
  if ([int]$response.StatusCode -ne $Expected) {
    throw "FAIL ${Name}: expected HTTP $Expected, received HTTP $($response.StatusCode)"
  }
  Write-Host "PASS $Name (HTTP $Expected)"
  return $response
}

$base = $ApiUrl.TrimEnd('/')
$apiKey = Read-EnvValue -Path $EnvFile -Name 'SHAPI_API_KEY'
if (-not $apiKey) { throw "SHAPI_API_KEY was not found in $EnvFile" }

$health = Assert-Status 'API liveness' "$base/health" 200
if (-not $health.Headers['x-content-type-options']) {
  throw 'FAIL security headers: x-content-type-options is missing'
}
Write-Host 'PASS security headers (x-content-type-options present)'

Assert-Status 'Missing API key rejected' "$base/api/v1/alerts/status" 401 | Out-Null
Assert-Status 'Invalid API key rejected' "$base/api/v1/alerts/status" 401 @{ 'x-api-key' = 'invalid-security-smoke-key' } | Out-Null
Assert-Status 'Unauthenticated metrics rejected' "$base/metrics" 404 | Out-Null

$status = Assert-Status 'Authenticated alert status' "$base/api/v1/alerts/status" 200 @{ 'x-api-key' = $apiKey }
$payload = $status.Content | ConvertFrom-Json
foreach ($field in @('webhookConfigured', 'pending', 'processing', 'retrying', 'delivered', 'failed')) {
  if ($null -eq $payload.$field) { throw "FAIL alert status: missing '$field'" }
}
Write-Host 'PASS alert status shape (no secret fields returned)'

Write-Host 'Security smoke check passed.'
