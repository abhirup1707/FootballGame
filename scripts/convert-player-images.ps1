Add-Type -AssemblyName System.Drawing
Get-ChildItem -Path (Join-Path $PSScriptRoot '..\public\players') -Filter *.png | ForEach-Object {
  try {
    $source = [System.Drawing.Image]::FromFile($_.FullName)
    $bitmap = New-Object System.Drawing.Bitmap $source
    $source.Dispose()
    $bitmap.Save($_.FullName, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
  } catch {
    Write-Warning "Could not convert $($_.Name): $($_.Exception.Message)"
  }
}
