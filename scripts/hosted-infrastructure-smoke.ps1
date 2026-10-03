[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,
  [Parameter(Mandatory = $true)]
  [string]$DashboardUrl,
  [int]$StartupTimeoutSec = 120,
  [int]$RetryDelaySec = 3
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'http-request-compat.ps1')

if ($StartupTimeoutSec -lt 1) { throw 'StartupTimeoutSec must be positive' }
if ($RetryDelaySec -lt 1) { throw 'RetryDelaySec must be positive' }

function Assert-PublicHttpsUrl([string]$Name, [string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne 'https') {
    throw "$Name must be an absolute HTTPS URL: $Value"
  }
  if ($parsed.Host -in @('localhost', '127.0.0.1', '::1')) {
    throw "$Name must point to a hosted public endpoint, not $($parsed.Host)"
  }
  if (-not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw "$Name must not contain credentials"
  }
}

function Invoke-ExpectedResponse(
  [string]$Name,
  [string]$Uri,
  [int]$ExpectedStatus,
  [string]$Method = 'GET',
  [hashtable]$Headers = @{}
) {
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
  $lastResult = 'no response'
  do {
    try {
      $response = Invoke-HttpRequestCompat -Parameters @{
        Method = $Method
        Uri = $Uri
        Headers = $Headers
        UseBasicParsing = $true
        SkipHttpErrorCheck = $true
        TimeoutSec = 15
      }
      if ([int]$response.StatusCode -eq $ExpectedStatus) {
        Write-Host "PASS $Name (HTTP $ExpectedStatus)"
        return $response
      }
      $lastResult = "HTTP $($response.StatusCode)"
    } catch {
      $lastResult = $_.Exception.Message
    }
    if ((Get-Date) -lt $deadline) { Start-Sleep -Seconds $RetryDelaySec }
  } while ((Get-Date) -lt $deadline)

  throw "FAIL ${Name}: expected HTTP $ExpectedStatus from $Uri after $StartupTimeoutSec seconds; last result: $lastResult"
}

function Header-Value($Response, [string]$Name) {
  $value = $Response.Headers[$Name]
  if ($null -eq $value) { return '' }
  return [string]($value -join ', ')
}

function Assert-HeaderContains($Response, [string]$CheckName, [string]$HeaderName, [string]$Pattern) {
  $value = Header-Value $Response $HeaderName
  if ($value -notmatch $Pattern) {
    throw "FAIL ${CheckName}: $HeaderName is missing or invalid"
  }
  Write-Host "PASS $CheckName"
}

Assert-PublicHttpsUrl 'ApiUrl' $ApiUrl
Assert-PublicHttpsUrl 'DashboardUrl' $DashboardUrl

$apiBase = $ApiUrl.TrimEnd('/')
$dashboardBase = $DashboardUrl.TrimEnd('/')
$dashboardOrigin = ([Uri]$dashboardBase).GetLeftPart([UriPartial]::Authority)

$health = Invoke-ExpectedResponse 'API liveness' "$apiBase/health" 200
$healthPayload = $health.Content | ConvertFrom-Json
if ($healthPayload.status -ne 'ok') { throw "FAIL API liveness payload: expected status 'ok'" }
Write-Host 'PASS API liveness payload'

$ready = Invoke-ExpectedResponse 'Database readiness' "$apiBase/ready" 200
$readyPayload = $ready.Content | ConvertFrom-Json
if ($readyPayload.status -ne 'ready') { throw "FAIL database readiness payload: expected status 'ready'" }
Write-Host 'PASS database readiness payload'

Assert-HeaderContains $health 'API HSTS' 'Strict-Transport-Security' '(?i)max-age='
Assert-HeaderContains $health 'API MIME sniffing protection' 'X-Content-Type-Options' '(?i)\bnosniff\b'
Assert-HeaderContains $health 'API frame protection' 'X-Frame-Options' '(?i)\bSAMEORIGIN\b'
Assert-HeaderContains $health 'API referrer policy' 'Referrer-Policy' '(?i)\bno-referrer\b'

$dashboardHealth = Invoke-ExpectedResponse 'Dashboard health' "$dashboardBase/health" 200
if ($dashboardHealth.Content.Trim() -ne 'ok') { throw "FAIL dashboard health payload: expected 'ok'" }
Write-Host 'PASS dashboard health payload'

$dashboard = Invoke-ExpectedResponse 'Dashboard document' "$dashboardBase/" 200
Assert-HeaderContains $dashboard 'Dashboard HTML content type' 'Content-Type' '(?i)^text/html\b'
Assert-HeaderContains $dashboard 'Dashboard HSTS' 'Strict-Transport-Security' '(?i)max-age='
Assert-HeaderContains $dashboard 'Dashboard MIME sniffing protection' 'X-Content-Type-Options' '(?i)\bnosniff\b'
Assert-HeaderContains $dashboard 'Dashboard frame protection' 'X-Frame-Options' '(?i)\bDENY\b'
Assert-HeaderContains $dashboard 'Dashboard referrer policy' 'Referrer-Policy' '(?i)\bno-referrer\b'

$runtimeConfig = Invoke-ExpectedResponse 'Dashboard runtime configuration' "$dashboardBase/config.js" 200
Assert-HeaderContains $runtimeConfig 'Runtime configuration is not cached' 'Cache-Control' '(?i)\bno-store\b'

Invoke-ExpectedResponse 'Direct unauthenticated API rejection' "$apiBase/api/v1/incidents" 401 | Out-Null
Invoke-ExpectedResponse 'Same-origin proxy unauthenticated rejection' "$dashboardBase/api/v1/incidents" 401 | Out-Null

$corsHeaders = @{
  Origin = $dashboardOrigin
  'Access-Control-Request-Method' = 'GET'
  'Access-Control-Request-Headers' = 'x-api-key'
}
$cors = Invoke-ExpectedResponse 'Dashboard CORS preflight' "$apiBase/api/v1/incidents" 204 'OPTIONS' $corsHeaders
if ((Header-Value $cors 'Access-Control-Allow-Origin') -ne $dashboardOrigin) {
  throw 'FAIL dashboard CORS preflight: Access-Control-Allow-Origin does not match the dashboard origin'
}
Assert-HeaderContains $cors 'Dashboard CORS method' 'Access-Control-Allow-Methods' '(?i)\bGET\b'
Assert-HeaderContains $cors 'Dashboard CORS API-key header' 'Access-Control-Allow-Headers' '(?i)\bx-api-key\b'

Write-Host 'Hosted infrastructure smoke passed without using tenant credentials.'
