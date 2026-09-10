param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path

if ([string]::IsNullOrWhiteSpace($Version)) {
    $config = Get-Content -LiteralPath (Join-Path $RootDir "src-tauri\tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = [string]$config.version
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid application version: $Version"
}

$MsiDir = [IO.Path]::GetFullPath((Join-Path $RootDir "src-tauri\target-lite\release\bundle\msi"))
$Source = [IO.Path]::GetFullPath((Join-Path $MsiDir "ErabiFlow_${Version}_x64_ja-JP.msi"))
$Destination = [IO.Path]::GetFullPath((Join-Path $MsiDir "ErabiFlow-${Version}-x64.msi"))
$SourceSignature = "$Source.sig"
$DestinationSignature = "$Destination.sig"

foreach ($path in @($Source, $Destination)) {
    if ([IO.Path]::GetDirectoryName($path) -ne $MsiDir) {
        throw "Refusing to move an MSI outside the light bundle directory: $path"
    }
}
if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Light MSI was not created: $Source"
}
if (Test-Path -LiteralPath $Destination -PathType Leaf) {
    Remove-Item -LiteralPath $Destination -Force
}
Move-Item -LiteralPath $Source -Destination $Destination
if (Test-Path -LiteralPath $SourceSignature -PathType Leaf) {
    if (Test-Path -LiteralPath $DestinationSignature -PathType Leaf) {
        Remove-Item -LiteralPath $DestinationSignature -Force
    }
    Move-Item -LiteralPath $SourceSignature -Destination $DestinationSignature
}
$Hash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
$ChecksumsPath = Join-Path $MsiDir "SHA256SUMS.txt"
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($ChecksumsPath, "$Hash  $([IO.Path]::GetFileName($Destination))`n", $Utf8NoBom)
Write-Host "Public MSI: $Destination"
Write-Host "SHA-256: $Hash"
