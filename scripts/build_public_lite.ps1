$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $RootDir

$SourceCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or (& git status --porcelain --untracked-files=normal)) {
    throw "Public MSI requires a clean committed source tree."
}

$DaemonBin = Join-Path $RootDir "src-tauri\binaries\gemma_daemon-x86_64-pc-windows-msvc\gemma_daemon.exe"
$WhisperDir = Join-Path $RootDir "python-sidecar\whisper-cpp"
$TargetRoot = Join-Path $RootDir "src-tauri\target-lite"

& pwsh -NoProfile -File (Join-Path $RootDir "scripts\bootstrap_dev.ps1") -SkipNpm -SkipPython
if ($LASTEXITCODE -ne 0) { throw "Pinned whisper.cpp runtime verification failed." }

foreach ($required in @(
    (Join-Path $WhisperDir "whisper-cli.exe"),
    (Join-Path $WhisperDir "ggml-silero-v6.2.0.bin"),
    (Join-Path $WhisperDir "ggml-base.dll"),
    (Join-Path $WhisperDir "ggml-cpu.dll"),
    (Join-Path $WhisperDir "ggml.dll"),
    (Join-Path $WhisperDir "whisper.dll")
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Public build input is missing: $required"
    }
}

& cmd.exe /c "python-sidecar\build.bat"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $DaemonBin -PathType Leaf)) {
    throw "gemma_daemon build failed."
}
& pwsh -NoProfile -File (Join-Path $RootDir "scripts\clean_stale_release_resources.ps1") -TargetName target-lite
if ($LASTEXITCODE -ne 0) { throw "Public resource cleanup failed." }

$env:VITE_ERABIFLOW_CHANNEL = "beta"
$env:VITE_ERABIFLOW_UPDATER_ENABLED = "false"
$env:CARGO_TARGET_DIR = $TargetRoot

& npx.cmd tauri build --ci --config "src-tauri\tauri.production.conf.json" --config "src-tauri\tauri.lite.conf.json"
if ($LASTEXITCODE -ne 0) { throw "ErabiFlow Public build failed." }
$BuiltApp = Join-Path $TargetRoot "release\erabiflow.exe"
if (-not (Test-Path -LiteralPath $BuiltApp -PathType Leaf)) {
    throw "ErabiFlow Public executable was not created: $BuiltApp"
}
& node (Join-Path $RootDir "scripts\desktop_daemon_smoke.mjs") $BuiltApp
if ($LASTEXITCODE -ne 0) { throw "Packaged desktop daemon recovery smoke failed." }
& pwsh -NoProfile -File (Join-Path $RootDir "scripts\name_light_msi.ps1")
if ($LASTEXITCODE -ne 0) { throw "Public MSI naming failed." }
$MsiPath = Join-Path $TargetRoot "release\bundle\msi\ErabiFlow-0.1.0-x64.msi"
if ((& git rev-parse HEAD).Trim() -ne $SourceCommit -or (& git status --porcelain --untracked-files=normal)) {
    throw "Source changed during the public build; this MSI is not a release candidate."
}
[ordered]@{
    sourceCommit = $SourceCommit
    builtAt = [DateTimeOffset]::UtcNow.ToString("o")
    filename = [IO.Path]::GetFileName($MsiPath)
    bytes = (Get-Item -LiteralPath $MsiPath).Length
    sha256 = (Get-FileHash -LiteralPath $MsiPath -Algorithm SHA256).Hash.ToLowerInvariant()
    channel = "beta"
    unsigned = $true
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RootDir "release\candidate.local.json") -Encoding UTF8
