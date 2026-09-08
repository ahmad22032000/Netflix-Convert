Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPath = "d:\PROJECT AI\Netflix Convert\deploy.zip"
$sourceDir = "d:\PROJECT AI\Netflix Convert\_deploy"

# Clean up
Remove-Item $zipPath -ErrorAction SilentlyContinue

# Create zip with forward slashes
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)

$files = Get-ChildItem $sourceDir -Recurse -File
foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($sourceDir.Length + 1)
    # Convert backslashes to forward slashes
    $entryName = $relativePath.Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName) | Out-Null
    Write-Host "Added: $entryName"
}

$zip.Dispose()
Write-Host "`ndeploy.zip created successfully with forward slash paths!"
