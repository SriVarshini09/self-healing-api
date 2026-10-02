[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$EnvFile
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw "Environment file not found: $EnvFile"
}

$seen = @{}
$lineNumber = 0
foreach ($line in Get-Content -LiteralPath $EnvFile) {
  $lineNumber++
  $trimmed = $line.Trim()
  if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }

  if ($trimmed -notmatch '^(?:export\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=') {
    throw "Invalid .env syntax at line ${lineNumber}: expected NAME=VALUE. Secret contents are intentionally omitted."
  }

  $name = $Matches.name
  if ($seen.ContainsKey($name)) {
    throw "Duplicate environment variable '$name' at line ${lineNumber}; it was already defined at line $($seen[$name])."
  }
  $seen[$name] = $lineNumber
}

Write-Host "Environment file syntax passed: $($seen.Count) variables ($EnvFile)"
