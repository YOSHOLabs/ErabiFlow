$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$ReleaseDir = Join-Path $RootDir "src-tauri\target-lite\release"
$MsiDir = Join-Path $ReleaseDir "bundle\msi"
$Msi = Get-ChildItem -LiteralPath $MsiDir -Filter "*_light.msi" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
$App = Get-Item -LiteralPath (Join-Path $ReleaseDir "erabiflow.exe") -ErrorAction SilentlyContinue
$Wix = Join-Path $ReleaseDir "wix\x64\main.wxs"
$WhisperStage = Join-Path $ReleaseDir "whisper-cpp"
$ExpectedRuntime = @(
    "whisper-cli.exe",
    "ggml-silero-v6.2.0.bin",
    "ggml-base.dll",
    "ggml-cpu.dll",
    "ggml.dll",
    "whisper.dll"
)

if (-not $Msi -or -not $App) {
    throw "Light release artifacts are missing. Run .\build_release_lite.bat."
}
if (-not (Test-Path -LiteralPath $Wix -PathType Leaf)) {
    throw "Light MSI manifest is missing: $Wix"
}
if ($Msi.Length -gt 256MB) {
    throw ("Light MSI is unexpectedly large ({0:N2} MiB). The Whisper model may have leaked into it." -f ($Msi.Length / 1MB))
}

$ForbiddenNames = @("ggml-large-v3-turbo.bin", "ggml-large-v3.bin")
foreach ($name in $ForbiddenNames) {
    if (Test-Path -LiteralPath (Join-Path $WhisperStage $name) -PathType Leaf) {
        throw "Light staging contains the forbidden large model: $name"
    }
    if (Select-String -LiteralPath $Wix -Pattern $name -SimpleMatch -Quiet) {
        throw "Light MSI manifest contains the forbidden large model: $name"
    }
}

foreach ($name in $ExpectedRuntime) {
    if (-not (Test-Path -LiteralPath (Join-Path $WhisperStage $name) -PathType Leaf)) {
        throw "Light staging is missing Whisper runtime file: $name"
    }
    if (-not (Select-String -LiteralPath $Wix -Pattern $name -SimpleMatch -Quiet)) {
        throw "Light MSI manifest is missing Whisper runtime file: $name"
    }
}
if (-not (Select-String -LiteralPath $Wix -Pattern "THIRD_PARTY_NOTICES.txt" -SimpleMatch -Quiet)) {
    throw "Light MSI manifest is missing THIRD_PARTY_NOTICES.txt."
}
if (-not (Select-String -LiteralPath $Wix -Pattern "Apache-2.0.txt" -SimpleMatch -Quiet)) {
    throw "Light MSI manifest is missing the Apache-2.0 license text."
}
if (-not (Select-String -LiteralPath $Wix -Pattern "DEPENDENCY_LICENSES.generated.txt" -SimpleMatch -Quiet)) {
    throw "Light MSI manifest is missing the generated dependency license bundle."
}
foreach ($runtimeLicense in @(
    "Python-LICENSE.txt",
    "PyInstaller-COPYING.txt",
    "PyInstaller-Hooks-LICENSE.txt",
    "altgraph-LICENSE.txt",
    "packaging-Apache-2.0.txt",
    "packaging-BSD-2-Clause.txt",
    "pefile-LICENSE.txt",
    "pywin32-ctypes-LICENSE.txt",
    "setuptools-LICENSE.txt"
)) {
    if (-not (Select-String -LiteralPath $Wix -Pattern $runtimeLicense -SimpleMatch -Quiet)) {
        throw "Light MSI manifest is missing the daemon runtime license: $runtimeLicense"
    }
}
foreach ($ffmpegName in @("ffmpeg-x86_64-pc-windows-msvc.exe", "ffmpeg.exe")) {
    if (Select-String -LiteralPath $Wix -Pattern $ffmpegName -SimpleMatch -Quiet) {
        throw "Light MSI must not redistribute FFmpeg: $ffmpegName"
    }
}

$SourceFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $RootDir "src") -Recurse -File
    Get-ChildItem -LiteralPath (Join-Path $RootDir "src-tauri\src") -Recurse -File
    Get-ChildItem -LiteralPath (Join-Path $RootDir "python-sidecar") -Recurse -File |
        Where-Object { $_.FullName -notmatch '\\(build|dist|__pycache__|whisper-cpp)\\' }
    Get-Item -LiteralPath (Join-Path $RootDir "src-tauri\Cargo.toml")
    Get-Item -LiteralPath (Join-Path $RootDir "src-tauri\Cargo.lock")
    Get-Item -LiteralPath (Join-Path $RootDir "src-tauri\tauri.conf.json")
    Get-Item -LiteralPath (Join-Path $RootDir "src-tauri\tauri.lite.conf.json")
    Get-Item -LiteralPath (Join-Path $RootDir "build_release_lite.bat")
)
$LatestSource = $SourceFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if ($App.LastWriteTimeUtc -lt $LatestSource.LastWriteTimeUtc -or $Msi.LastWriteTimeUtc -lt $LatestSource.LastWriteTimeUtc) {
    throw "Light release is older than $($LatestSource.Name). Run .\build_release_lite.bat again."
}

$Hash = (Get-FileHash -LiteralPath $Msi.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "LIGHT RELEASE: PASS" -ForegroundColor Green
Write-Host ("MSI: {0} ({1:N2} MiB)" -f $Msi.FullName, ($Msi.Length / 1MB))
Write-Host "SHA-256: $Hash"
Write-Host "Whisper runtime: $($ExpectedRuntime.Count) required files; large model: absent; FFmpeg: official first-run download"
