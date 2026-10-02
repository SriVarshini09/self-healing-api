[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$DashboardUrl = 'http://localhost:8080',
  [string]$EnvFile = '.env',
  [int]$StartupTimeoutSec = 60,
  [int]$RetryDelaySec = 2,
  [switch]$RequireGitHubApp
)

$ErrorActionPreference = 'Stop'

if ($StartupTimeoutSec -lt 1) { throw 'StartupTimeoutSec must be positive' }
if ($RetryDelaySec -lt 1) { throw 'RetryDelaySec must be positive' }

function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$([regex]::Escape($Name))=", '').Trim().Trim('"')
}

function Check-Http([string]$Name, [string]$Uri, [hashtable]$Headers = @{}) {
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
  $lastError = 'no response'
  do {
    try {
      $response = Invoke-WebRequest -Uri $Uri -Headers $Headers -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -eq 200) {
        Write-Host "PASS $Name ($($response.StatusCode))"
        return $response
      }
      $lastError = "HTTP $($response.StatusCode)"
    } catch {
      $lastError = $_.Exception.Message
    }
    if ((Get-Date) -lt $deadline) { Start-Sleep -Seconds $RetryDelaySec }
  } while ((Get-Date) -lt $deadline)

  throw "FAIL $Name ($Uri) after $StartupTimeoutSec seconds: $lastError"
  }

Check-Http 'API liveness' "$($ApiUrl.TrimEnd('/'))/health" | Out-Null
Check-Http 'Database readiness' "$($ApiUrl.TrimEnd('/'))/ready" | Out-Null
$dashboard = Check-Http 'Dashboard' "$($DashboardUrl.TrimEnd('/'))/"

$dashboardHeaders = @{
  'Strict-Transport-Security' = '(?i)max-age='
  'X-Content-Type-Options' = '(?i)\bnosniff\b'
  'X-Frame-Options' = '(?i)\bDENY\b'
  'Referrer-Policy' = '(?i)\bno-referrer\b'
}
foreach ($entry in $dashboardHeaders.GetEnumerator()) {
  $value = [string]($dashboard.Headers[$entry.Key] -join ', ')
  if ($value -notmatch $entry.Value) {
    throw "FAIL Dashboard security headers: $($entry.Key) is missing or invalid"
  }
}
Write-Host 'PASS Dashboard security headers'

$runtimeConfig = Check-Http 'Dashboard runtime configuration' "$($DashboardUrl.TrimEnd('/'))/config.js"
$cacheControl = [string]($runtimeConfig.Headers['Cache-Control'] -join ', ')
if ($cacheControl -notmatch '(?i)\bno-store\b') {
  throw 'FAIL Dashboard runtime configuration: Cache-Control must include no-store'
}
if ($runtimeConfig.Headers['ETag']) {
  throw 'FAIL Dashboard runtime configuration: ETag must be disabled'
}
Write-Host 'PASS Dashboard runtime configuration cache protection'

$apiKey = Read-EnvValue -Path $EnvFile -Name 'SHAPI_API_KEY'
if ($apiKey) {
  $status = Invoke-RestMethod -Uri "$($ApiUrl.TrimEnd('/'))/api/v1/github/status" -Headers @{ 'x-api-key' = $apiKey }
  if ($RequireGitHubApp -and $status.mode -ne 'app') {
    throw "FAIL GitHub App readiness: mode is '$($status.mode)'"
  }
  if ($RequireGitHubApp -and -not $status.appInstallUrl) {
    throw 'FAIL GitHub App readiness: appInstallUrl is not configured'
  }
  Write-Output "PASS GitHub readiness (mode=$($status.mode), repositories=$($status.repositoryCount))"
} else {
  if ($RequireGitHubApp) { throw "FAIL GitHub readiness: SHAPI_API_KEY was not found in $EnvFile" }
  Write-Output 'SKIP GitHub readiness (no SHAPI_API_KEY was supplied)'
}

Write-Output 'Smoke check passed.'
