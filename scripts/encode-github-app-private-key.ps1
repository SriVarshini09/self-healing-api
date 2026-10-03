[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PemFile,
  [string]$OutputFile,
  [switch]$CopyToClipboard
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PemFile -PathType Leaf)) {
  throw "PEM file not found: $PemFile"
}
if ($OutputFile -and $CopyToClipboard) {
  throw 'Choose exactly one output mode: -OutputFile or -CopyToClipboard.'
}
if (-not $OutputFile -and -not $CopyToClipboard) {
  throw 'Choose an output mode: -OutputFile <path> or -CopyToClipboard.'
}

$pem = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $PemFile), [Text.Encoding]::UTF8)
$pem = ($pem -replace "`r`n", "`n" -replace "`r", "`n").Trim()
if ($pem -notmatch '(?s)^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+.+\s+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----$') {
  throw 'The input file is not a complete PEM private key. The key value was not printed.'
}

$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pem))
if ($OutputFile) {
  $parent = Split-Path -Parent $OutputFile
  if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "Output directory not found: $parent"
  }
  [IO.File]::WriteAllText($OutputFile, $encoded, [Text.Encoding]::ASCII)
  Write-Host "Wrote one-line Base64 private key to $OutputFile. The value was not printed."
} else {
  Set-Clipboard -Value $encoded
  Write-Host 'Copied one-line Base64 private key to the clipboard. The value was not printed.'
}
Write-Host "Encoded private key length: $($encoded.Length) characters."
