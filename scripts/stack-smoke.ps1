[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$DashboardUrl = 'http://localhost:8080',
  [string]$EnvFile = '.env',
  [switch]$RequireGitHubApp
)

$ErrorActionPreference = 'Stop'

function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$([regex]::Escape($Name))=", '').Trim().Trim('"')
}

function Check-Http([string]$Name, [string]$Uri, [hashtable]$Headers = @{}) {
  try {
    $response = Invoke-WebRequest -Uri $Uri -Headers $Headers -UseBasicParsing
    if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode)" }
    Write-Host "PASS $Name ($($response.StatusCode))"
    return $response
  } catch {
    throw "FAIL $Name ($Uri): $($_.Exception.Message)"
  }
}

Check-Http 'API liveness' "$($ApiUrl.TrimEnd('/'))/health" | Out-Null
Check-Http 'Database readiness' "$($ApiUrl.TrimEnd('/'))/ready" | Out-Null
Check-Http 'Dashboard' "$($DashboardUrl.TrimEnd('/'))/" | Out-Null

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
