[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [Parameter(Mandatory = $true)]
  [string]$EnvFile
)

$ErrorActionPreference = 'Stop'

function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Environment file not found: $Path" }
  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$([regex]::Escape($Name))=", '').Trim().Trim('"').Trim("'")
}

function Get-Signature([string]$Secret, [string]$Body) {
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($Secret))
  try {
    $digest = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Body))
    return 'sha256=' + ([Convert]::ToHexString($digest).ToLowerInvariant())
  } finally {
    $hmac.Dispose()
  }
}

$secret = Read-EnvValue -Path $EnvFile -Name 'GITHUB_WEBHOOK_SECRET_APP'
if ([string]::IsNullOrWhiteSpace($secret)) {
  throw "GITHUB_WEBHOOK_SECRET_APP was not found in $EnvFile"
}

$delivery = [Guid]::NewGuid().ToString()
$body = '{"zen":"SHAPI signed webhook smoke","hook_id":0}'
$headers = @{
  'User-Agent' = 'SHAPI-webhook-smoke'
  'X-GitHub-Event' = 'ping'
  'X-GitHub-Delivery' = $delivery
  'X-Hub-Signature-256' = Get-Signature -Secret $secret -Body $body
}
$uri = "$($ApiUrl.TrimEnd('/'))/api/v1/github/webhook"

function Send-Delivery([hashtable]$RequestHeaders) {
  return Invoke-WebRequest `
    -Method Post `
    -Uri $uri `
    -Headers $RequestHeaders `
    -ContentType 'application/json' `
    -Body $body `
    -UseBasicParsing `
    -SkipHttpErrorCheck
}

$first = Send-Delivery -RequestHeaders $headers
if ([int]$first.StatusCode -ne 200) {
  throw "FAIL signed GitHub webhook: expected HTTP 200, received HTTP $($first.StatusCode): $($first.Content)"
}
$firstPayload = $first.Content | ConvertFrom-Json
if ($firstPayload.received -ne $true -or $firstPayload.duplicate -eq $true) {
  throw 'FAIL signed GitHub webhook: first delivery was not accepted as new'
}
Write-Host "PASS signed GitHub webhook (HTTP 200, delivery $delivery)"

$second = Send-Delivery -RequestHeaders $headers
if ([int]$second.StatusCode -ne 200) {
  throw "FAIL GitHub webhook deduplication: expected HTTP 200, received HTTP $($second.StatusCode): $($second.Content)"
}
$secondPayload = $second.Content | ConvertFrom-Json
if ($secondPayload.duplicate -ne $true) {
  throw 'FAIL GitHub webhook deduplication: repeated delivery was processed again'
}
Write-Host 'PASS GitHub webhook deduplication (repeat acknowledged as duplicate)'

Write-Host 'GitHub webhook smoke check passed.'
