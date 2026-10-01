[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,
  [Parameter(Mandatory = $true)]
  [string]$EnvFile,
  [Parameter(Mandatory = $true)]
  [string]$TenantName,
  [Parameter(Mandatory = $true)]
  [string]$Slug,
  [string]$KeyName = 'Initial admin key',
  [string]$ExpiresAt,
  [switch]$DryRun
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

function Assert-PublicHttpsUrl([string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne 'https') {
    throw "ApiUrl must be an absolute HTTPS URL for hosted onboarding: $Value"
  }
  if ($parsed.Host -in @('localhost', '127.0.0.1', '::1')) {
    throw "ApiUrl must point to a hosted public endpoint, not $($parsed.Host)"
  }
}

Assert-PublicHttpsUrl $ApiUrl
$bootstrapToken = Read-EnvValue -Path $EnvFile -Name 'SHAPI_BOOTSTRAP_TOKEN'
if ([string]::IsNullOrWhiteSpace($bootstrapToken)) {
  throw "SHAPI_BOOTSTRAP_TOKEN was not found in $EnvFile"
}

$body = [ordered]@{
  tenantName = $TenantName
  slug = $Slug
  keyName = $KeyName
}
if ($ExpiresAt) { $body.expiresAt = $ExpiresAt }

if ($DryRun) {
  Write-Output "Would bootstrap tenant '$TenantName' ($Slug) at $($ApiUrl.TrimEnd('/'))/api/v1/bootstrap/tenant"
  Write-Output 'No request was sent and no secret was printed.'
  exit 0
}

$response = Invoke-WebRequest `
  -Method Post `
  -Uri "$($ApiUrl.TrimEnd('/'))/api/v1/bootstrap/tenant" `
  -Headers @{ 'x-bootstrap-token' = $bootstrapToken } `
  -ContentType 'application/json' `
  -Body ($body | ConvertTo-Json -Compress) `
  -UseBasicParsing `
  -SkipHttpErrorCheck

if ([int]$response.StatusCode -ne 201) {
  throw "Hosted tenant bootstrap failed with HTTP $($response.StatusCode): $($response.Content)"
}

$result = $response.Content | ConvertFrom-Json
if (-not $result.key -or -not $result.tenant.id) {
  throw 'Hosted tenant bootstrap returned an incomplete response'
}

Write-Output "Tenant created: $($result.tenant.name) ($($result.tenant.slug))"
Write-Output "Tenant ID: $($result.tenant.id)"
Write-Output ''
Write-Output 'OWNER_API_KEY (copy now; SHAPI will not return it again):'
Write-Output $result.key
