param(
    [ValidateSet("target", "target-lite")]
    [string]$TargetName = "target"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$TargetRelease = [IO.Path]::GetFullPath((Join-Path $RootDir "src-tauri\$TargetName\release"))
$AllowedNames = @("gemma_daemon", "whisper-cpp")
$RemovedBytes = 0L
$RemovedFiles = 0

foreach ($name in $AllowedNames) {
    $candidate = [IO.Path]::GetFullPath((Join-Path $TargetRelease $name))
    if ([IO.Path]::GetDirectoryName($candidate) -ne $TargetRelease) {
        throw "Refusing to clean a path outside $TargetName/release: $candidate"
    }
    if ([IO.Path]::GetFileName($candidate) -notin $AllowedNames) {
        throw "Refusing to clean an unexpected release resource: $candidate"
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { continue }

    $resolved = (Resolve-Path -LiteralPath $candidate).Path
    if ($resolved -ne $candidate) {
        throw "Resolved cleanup path differs from the expected path: $resolved"
    }
    $files = @(Get-ChildItem -LiteralPath $resolved -Recurse -File -Force)
    $RemovedFiles += $files.Count
    $sum = ($files | Measure-Object Length -Sum).Sum
    if ($null -ne $sum) { $RemovedBytes += [long]$sum }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    if (Test-Path -LiteralPath $resolved) {
        throw "Failed to remove stale release resource: $resolved"
    }
}

# 旧軽量ビルドが残したFFmpeg sidecarを、検証済みの固定ファイル名だけ削除する。
# 公開軽量MSIは初回に公式配布元から取得するため、このファイルを再利用しない。
$sidecarFileName = "ffmpeg-x86_64-pc-windows-msvc.exe"
$sidecarFilePath = [IO.Path]::GetFullPath((Join-Path -Path $TargetRelease -ChildPath "ffmpeg-x86_64-pc-windows-msvc.exe"))
$sidecarDirectory = [IO.Path]::GetDirectoryName($sidecarFilePath).TrimEnd([IO.Path]::DirectorySeparatorChar)
$targetDirectory = $TargetRelease.TrimEnd([IO.Path]::DirectorySeparatorChar)
$directoryMatches = [String]::Equals($sidecarDirectory, $targetDirectory, [StringComparison]::OrdinalIgnoreCase)
$fileMatches = [String]::Equals([IO.Path]::GetFileName($sidecarFilePath), "ffmpeg-x86_64-pc-windows-msvc.exe", [StringComparison]::OrdinalIgnoreCase)
if (-not $directoryMatches -or -not $fileMatches) {
    throw "Refusing to clean an unexpected sidecar path: $sidecarFilePath"
}
if (Test-Path -LiteralPath $sidecarFilePath -PathType Leaf) {
    $sidecar = Get-Item -LiteralPath $sidecarFilePath
    $RemovedFiles += 1
    $RemovedBytes += $sidecar.Length
    Remove-Item -LiteralPath $sidecarFilePath -Force
}

Write-Host ("Cleaned release resource staging: {0} files / {1:N2} MiB" -f $RemovedFiles, ($RemovedBytes / 1MB))
