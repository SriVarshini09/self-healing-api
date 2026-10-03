function Invoke-HttpRequestCompat {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Parameters
  )

  $requestParameters = @{}
  foreach ($entry in $Parameters.GetEnumerator()) {
    $requestParameters[$entry.Key] = $entry.Value
  }

  $supportsSkipHttpErrorCheck = (Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')
  if ($supportsSkipHttpErrorCheck) {
    $requestParameters['SkipHttpErrorCheck'] = $true
  } else {
    $requestParameters.Remove('SkipHttpErrorCheck')
  }

  try {
    return Invoke-WebRequest @requestParameters
  } catch {
    # Windows PowerShell 5.1 throws for non-2xx responses because it does not
    # support -SkipHttpErrorCheck. Convert that error into the same small
    # response shape used by newer PowerShell versions.
    $webResponse = $_.Exception.Response
    if ($supportsSkipHttpErrorCheck -or $null -eq $webResponse) { throw }

    $content = ''
    $stream = $null
    $reader = $null
    try {
      $stream = $webResponse.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
      }
    } finally {
      if ($reader) { $reader.Dispose() }
      if ($stream) { $stream.Dispose() }
    }

    return [pscustomobject]@{
      StatusCode = [int]$webResponse.StatusCode
      Content = $content
      Headers = $webResponse.Headers
    }
  }
}
