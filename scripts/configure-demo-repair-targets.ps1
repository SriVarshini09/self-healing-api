[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$EnvFile = '.env',
  [string]$Repository = 'SriVarshini09/self-healing-api',
  [string]$FilePath = 'apps/backend/prisma/seed.ts',
  [string[]]$RequiredChecks = @('verify'),
  [string[]]$InvariantIds = @(
    'inv-stripe-payment-succeeded',
    'inv-stripe-subscription-active',
    'inv-stripe-refund-succeeded'
  ),
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$([regex]::Escape($Name))=", '').Trim().Trim('"').Trim("'")
}

if ($Repository -notmatch '^[^/\s]+/[^/\s]+$') {
  throw 'Repository must be in owner/repository form'
}
if ([string]::IsNullOrWhiteSpace($FilePath) -or $FilePath -match '(^/|^[A-Za-z]:|\\|(^|/)\.\.(/|$)|(^|/)\.(/|$))') {
  throw 'FilePath must be a non-empty repository-relative POSIX path without traversal'
}
if ($RequiredChecks.Count -eq 0 -or @($RequiredChecks | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
  throw 'At least one non-empty required GitHub check is required'
}
if ($InvariantIds.Count -eq 0) { throw 'At least one invariant ID is required' }

$apiKey = Read-EnvValue -Path $EnvFile -Name 'SHAPI_API_KEY'
if (-not $apiKey) { throw "SHAPI_API_KEY was not found in $EnvFile" }

$headers = @{ 'x-api-key' = $apiKey }
$baseUrl = $ApiUrl.TrimEnd('/')
$response = Invoke-RestMethod -Uri "$baseUrl/api/v1/invariants?pageSize=100" -Headers $headers
$rows = @($response.data)
$targetFile = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) $FilePath
if (-not (Test-Path -LiteralPath $targetFile)) { throw "Target file was not found locally: $targetFile" }
$source = Get-Content -LiteralPath $targetFile -Raw

$body = @{
  repairRepository = $Repository
  repairFilePath = $FilePath
  repairRequiredChecks = @($RequiredChecks)
} | ConvertTo-Json -Compress

foreach ($id in $InvariantIds) {
  $invariant = $rows | Where-Object { $_.id -eq $id } | Select-Object -First 1
  if (-not $invariant) { throw "Invariant was not found for the authenticated tenant: $id" }
  $occurrences = [regex]::Matches($source, [regex]::Escape([string]$invariant.predicateExpression)).Count
  if ($occurrences -ne 1) {
    throw "Target precondition for $id must occur exactly once in $FilePath; found $occurrences occurrences"
  }

  if ($Apply) {
    $updated = Invoke-RestMethod -Method Patch -Uri "$baseUrl/api/v1/invariants/$id" -Headers $headers -ContentType 'application/json' -Body $body
    if ($updated.repairRepository -ne $Repository -or $updated.repairFilePath -ne $FilePath) {
      throw "API did not persist the expected target for $id"
    }
    $actualChecks = @($updated.repairRequiredChecks)
    if ((Compare-Object -ReferenceObject @($RequiredChecks) -DifferenceObject $actualChecks)) {
      throw "API did not persist the expected required checks for $id"
    }
    Write-Output "Mapped $id -> $Repository/$FilePath (checks: $($RequiredChecks -join ', '))"
  } else {
    Write-Output "Would map $id -> $Repository/$FilePath (checks: $($RequiredChecks -join ', '))"
  }
}

if (-not $Apply) {
  Write-Output 'Dry run only. Re-run with -Apply to persist these reviewed mappings.'
}
