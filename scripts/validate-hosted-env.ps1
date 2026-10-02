[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$EnvFile,
  [switch]$RequireGitHubApp,
  [switch]$RequireOidc
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw "Environment file not found: $EnvFile"
}

& "$PSScriptRoot\validate-env.ps1" -EnvFile $EnvFile

function Read-EnvValue([hashtable]$Values, [string]$Name) {
  if (-not $Values.ContainsKey($Name)) { return $null }
  return [string]$Values[$Name]
}

function Assert-Set([hashtable]$Values, [string]$Name) {
  $value = Read-EnvValue $Values $Name
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Hosted environment is missing required value '$Name'. The value was not printed."
  }
  if ($value -match '(?i)^(your_|change[-_]me|replace[-_]me|placeholder|todo|example)') {
    throw "Hosted environment value '$Name' is still a placeholder. Replace it with the real secret without printing it."
  }
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $EnvFile) {
  $trimmed = $line.Trim()
  if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
  if ($trimmed -match '^(?:export\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)$') {
    $values[$Matches.name] = $Matches.value.Trim().Trim('"').Trim("'")
  }
}

Assert-Set $values 'SHAPI_API_KEY'
Assert-Set $values 'GITHUB_WEBHOOK_SECRET_APP'

$privateKeyNames = @('GITHUB_APP_PRIVATE_KEY_B64', 'GITHUB_APP_PRIVATE_KEY_FILE', 'GITHUB_APP_PRIVATE_KEY')
$configuredPrivateKeys = @($privateKeyNames | Where-Object { -not [string]::IsNullOrWhiteSpace((Read-EnvValue $values $_)) })
if ($RequireGitHubApp) {
  Assert-Set $values 'GITHUB_APP_ID'
  Assert-Set $values 'GITHUB_APP_SLUG'
  if ($configuredPrivateKeys.Count -ne 1) {
    throw "Hosted GitHub App configuration must set exactly one private-key source: $($privateKeyNames -join ', '). Secret values were not printed."
  }
} elseif ($configuredPrivateKeys.Count -gt 1) {
  throw "Hosted GitHub App configuration sets multiple private-key sources. Keep exactly one of: $($privateKeyNames -join ', ')."
}

$oidcNames = @('OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_DEFAULT_TENANT_SLUG')
$configuredOidc = @($oidcNames | Where-Object { -not [string]::IsNullOrWhiteSpace((Read-EnvValue $values $_)) })
if ($RequireOidc -or ($configuredOidc.Count -gt 0)) {
  foreach ($name in $oidcNames) { Assert-Set $values $name }
  $redirect = Read-EnvValue $values 'OIDC_REDIRECT_URI'
  $parsed = $null
  if (-not [Uri]::TryCreate($redirect, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne 'https' -or $parsed.AbsolutePath -ne '/api/v1/auth/callback') {
    throw 'OIDC_REDIRECT_URI must be an HTTPS URL ending exactly in /api/v1/auth/callback.'
  }
}

$alertUrl = Read-EnvValue $values 'ALERT_WEBHOOK_URL'
$alertSecret = Read-EnvValue $values 'ALERT_WEBHOOK_SECRET'
if ((-not [string]::IsNullOrWhiteSpace($alertUrl)) -xor (-not [string]::IsNullOrWhiteSpace($alertSecret))) {
  throw 'ALERT_WEBHOOK_URL and ALERT_WEBHOOK_SECRET must be configured together or both left empty.'
}

$bootstrap = Read-EnvValue $values 'SHAPI_BOOTSTRAP_TOKEN'
if (-not [string]::IsNullOrWhiteSpace($bootstrap) -and $bootstrap.Length -lt 32) {
  throw 'SHAPI_BOOTSTRAP_TOKEN must be at least 32 characters when present.'
}

$configured = @('SHAPI_API_KEY', 'GITHUB_WEBHOOK_SECRET_APP')
if ($RequireGitHubApp) { $configured += 'GITHUB_APP_ID', 'GITHUB_APP_SLUG', ($configuredPrivateKeys -join ',') }
if ($RequireOidc) { $configured += 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_DEFAULT_TENANT_SLUG' }
Write-Host "Hosted environment preflight passed: $($configured -join ', ') (secret values omitted)."
