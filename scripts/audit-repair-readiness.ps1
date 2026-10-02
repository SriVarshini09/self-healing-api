[CmdletBinding()]
param(
  [string]$ApiUrl = 'http://localhost:3001',
  [string]$EnvFile = '.env',
  [switch]$FailOnUnready,
  [switch]$Json
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

$apiKey = Read-EnvValue -Path $EnvFile -Name 'SHAPI_API_KEY'
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "SHAPI_API_KEY was not found in $EnvFile"
}

$baseUrl = $ApiUrl.TrimEnd('/')
$headers = @{ 'x-api-key' = $apiKey }
$response = Invoke-RestMethod -Uri "$baseUrl/api/v1/invariants?pageSize=100" -Headers $headers
$rows = @($response.data)

if ($rows.Count -eq 0) {
  throw 'The authenticated tenant returned no invariants to audit'
}

$audit = @($rows | ForEach-Object {
  $id = [string]$_.id
  $repository = [string]$_.repairRepository
  $filePath = [string]$_.repairFilePath
  $readiness = $_.repairReadiness
  if (-not $readiness -or [string]::IsNullOrWhiteSpace([string]$readiness.state)) {
    throw "Invariant $id did not include the backend repairReadiness decision"
  }
  $checks = @($readiness.requiredChecks | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  $mapped = -not [string]::IsNullOrWhiteSpace($repository) -and -not [string]::IsNullOrWhiteSpace($filePath)

  [pscustomobject]@{
    id = $id
    name = [string]$_.name
    integrationId = [string]$_.integrationId
    state = [string]$readiness.state
    reason = [string]$readiness.reason
    adapterId = if ($readiness.adapterId) { [string]$readiness.adapterId } else { $null }
    repository = if ($mapped) { $repository } else { $null }
    filePath = if ($mapped) { $filePath } else { $null }
    requiredChecks = @($checks)
  }
})

$unready = @($audit | Where-Object { $_.state -ne 'READY_FOR_TARGET_REVIEW' })
$summary = [pscustomobject]@{
  total = $audit.Count
  readyForTargetReview = @($audit | Where-Object state -eq 'READY_FOR_TARGET_REVIEW').Count
  manualReview = @($audit | Where-Object state -eq 'MANUAL_REVIEW').Count
  blockedNoRequiredChecks = @($audit | Where-Object state -eq 'BLOCKED_NO_REQUIRED_CHECKS').Count
  blockedMissingBusinessOutcomeCheck = @($audit | Where-Object state -eq 'BLOCKED_MISSING_BUSINESS_OUTCOME_CHECK').Count
  unready = $unready.Count
  invariants = $audit
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 8
} else {
  Write-Output "Repair readiness: $($summary.readyForTargetReview)/$($summary.total) ready for target review"
  Write-Output "Manual review: $($summary.manualReview); blocked without required checks: $($summary.blockedNoRequiredChecks); blocked without business-outcome: $($summary.blockedMissingBusinessOutcomeCheck)"
  $audit |
    Select-Object id, state, repository, filePath, @{Name = 'requiredChecks'; Expression = { $_.requiredChecks -join ', ' }} |
    Format-Table -AutoSize |
    Out-String |
    Write-Output
}

if ($FailOnUnready -and $summary.unready -gt 0) {
  throw "$($summary.unready) invariant(s) are not ready for automatic repair review"
}
