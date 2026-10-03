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
  [string]$ApiKeyOutputFile,
  [string]$DashboardApiKeyOutputFile,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'http-request-compat.ps1')

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

function Get-SafeOutputPath([string]$Path, [string]$Label) {
  $outputPath = [IO.Path]::GetFullPath($Path)
  $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $repoPrefix = "$repoRoot$([IO.Path]::DirectorySeparatorChar)"
  if (
    $outputPath.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $outputPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw "$Label must be outside the repository so the key cannot be committed accidentally"
  }
  if (Test-Path -LiteralPath $outputPath) {
    throw "Refusing to overwrite existing $Label file: $outputPath"
  }
  $parent = [IO.Path]::GetDirectoryName($outputPath)
  if (-not $parent -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "$Label directory does not exist: $parent"
  }
  return $outputPath
}

function Write-SafeApiKeyFile([string]$Path, [string]$Key, [string]$Label) {
  [IO.File]::WriteAllText($Path, "SHAPI_API_KEY=$Key$([Environment]::NewLine)", [Text.UTF8Encoding]::new($false))
  if (-not $IsWindows) {
    [IO.File]::SetUnixFileMode(
      $Path,
      [IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite
    )
  }
  Write-Output "$Label written to: $Path"
  Write-Output "$Label was not printed. Keep the output file outside the repository."
}

Assert-PublicHttpsUrl $ApiUrl
if ($DashboardApiKeyOutputFile -and -not $ApiKeyOutputFile) {
  throw 'DashboardApiKeyOutputFile requires ApiKeyOutputFile so the owner key is never printed'
}
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

$response = Invoke-HttpRequestCompat -Parameters @{
  Method = 'Post'
  Uri = "$($ApiUrl.TrimEnd('/'))/api/v1/bootstrap/tenant"
  Headers = @{ 'x-bootstrap-token' = $bootstrapToken }
  ContentType = 'application/json'
  Body = ($body | ConvertTo-Json -Compress)
  UseBasicParsing = $true
  SkipHttpErrorCheck = $true
}

if ([int]$response.StatusCode -ne 201) {
  throw "Hosted tenant bootstrap failed with HTTP $($response.StatusCode): $($response.Content)"
}

$result = $response.Content | ConvertFrom-Json
if (-not $result.key -or -not $result.tenant.id) {
  throw 'Hosted tenant bootstrap returned an incomplete response'
}

Write-Output "Tenant created: $($result.tenant.name) ($($result.tenant.slug))"
Write-Output "Tenant ID: $($result.tenant.id)"

if ($ApiKeyOutputFile) {
  $ownerOutputPath = Get-SafeOutputPath $ApiKeyOutputFile 'ApiKeyOutputFile'
  Write-SafeApiKeyFile $ownerOutputPath $result.key 'Owner API key'

  if ($DashboardApiKeyOutputFile) {
    $dashboardOutputPath = Get-SafeOutputPath $DashboardApiKeyOutputFile 'DashboardApiKeyOutputFile'
    $dashboardBody = @{
      name = 'Hosted dashboard runtime'
      permissions = @('read', 'write')
      role = 'OPERATOR'
    } | ConvertTo-Json -Compress
    $dashboardResponse = Invoke-HttpRequestCompat -Parameters @{
      Method = 'Post'
      Uri = "$($ApiUrl.TrimEnd('/'))/api/v1/api-keys"
      Headers = @{ 'x-api-key' = $result.key }
      ContentType = 'application/json'
      Body = $dashboardBody
      UseBasicParsing = $true
      SkipHttpErrorCheck = $true
    }
    if ([int]$dashboardResponse.StatusCode -ne 201) {
      throw "Dashboard API-key creation failed with HTTP $($dashboardResponse.StatusCode). The owner key is already stored at $ownerOutputPath."
    }
    $dashboardResult = $dashboardResponse.Content | ConvertFrom-Json
    if (-not $dashboardResult.key -or $dashboardResult.apiKey.role -ne 'OPERATOR') {
      throw 'Dashboard API-key creation returned an incomplete response'
    }
    Write-SafeApiKeyFile $dashboardOutputPath $dashboardResult.key 'Dashboard API key'
    Write-Output 'The dashboard key has read/write permissions with the OPERATOR role; it cannot administer API keys.'
    Write-Output 'For production, prefer OIDC so no API key is embedded in browser runtime configuration.'
  }
} else {
  Write-Output ''
  Write-Output 'OWNER_API_KEY (copy now; SHAPI will not return it again):'
  Write-Output $result.key
}
