$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $RootDir

$DefaultKeyRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) ".erabiflow\updater-keys"
$KeyPath = if ($env:ERABIFLOW_STABLE_UPDATER_KEY) { $env:ERABIFLOW_STABLE_UPDATER_KEY } else { Join-Path $DefaultKeyRoot "erabiflow-stable.key" }
$PasswordPath = if ($env:ERABIFLOW_STABLE_UPDATER_PASSWORD_FILE) { $env:ERABIFLOW_STABLE_UPDATER_PASSWORD_FILE } else { Join-Path $DefaultKeyRoot "erabiflow-stable.password.dpapi" }
$DaemonBin = Join-Path $RootDir "src-tauri\binaries\gemma_daemon-x86_64-pc-windows-msvc\gemma_daemon.exe"
$WhisperDir = Join-Path $RootDir "python-sidecar\whisper-cpp"
$TargetRoot = Join-Path $RootDir "src-tauri\target-lite"

foreach ($required in @(
    $KeyPath,
    $PasswordPath
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Public build input is missing: $required"
    }
}

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

$PublicConfig = Get-Content -LiteralPath (Join-Path $RootDir "src-tauri\tauri.production.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$UpdaterEndpoint = [string]$PublicConfig.plugins.updater.endpoints[0]
$env:VITE_ERABIFLOW_CHANNEL = "stable"
$env:VITE_ERABIFLOW_UPDATER_ENABLED = if ($UpdaterEndpoint -match '^https://' -and $UpdaterEndpoint -notmatch 'example\.invalid') { "true" } else { "false" }
$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
$SecurePassword = Get-Content -LiteralPath $PasswordPath -Raw | ConvertTo-SecureString
$Credential = [PSCredential]::new("erabiflow-updater", $SecurePassword)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Credential.GetNetworkCredential().Password
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
