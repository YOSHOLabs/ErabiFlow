param(
    [string]$ReportPath = ".\release\ffmpeg-download-smoke.local.json",
    [switch]$KeepDownload
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path -LiteralPath (Join-Path $ScriptDir "..")).Path
$ConfigPath = Join-Path $RootDir "release\ffmpeg-source.json"
$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Report = [System.IO.Path]::GetFullPath((Join-Path $RootDir $ReportPath))
$TempDir = Join-Path $RootDir ".tmp-ffmpeg-download-smoke"
$ArchivePath = Join-Path $TempDir "official-ffmpeg.zip.part"
$ExecutablePath = Join-Path $TempDir "ffmpeg.exe"
$ResumePrefixBytes = 1MB

function Assert-WorkspaceChild {
    param([string]$Path)

    $full = [System.IO.Path]::GetFullPath($Path)
    $rootPrefix = $RootDir.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Workspace外の一時パスは使用できません: $full"
    }
    return $full
}

function Remove-VerifiedDirectory {
    param([string]$Path)

    $safePath = Assert-WorkspaceChild $Path
    if (Test-Path -LiteralPath $safePath -PathType Container) {
        Remove-Item -LiteralPath $safePath -Recurse -Force
    }
}

function Assert-LastExitCode {
    param([string]$Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step に失敗しました: exit $LASTEXITCODE"
    }
}

$TempDir = Assert-WorkspaceChild $TempDir
Remove-VerifiedDirectory $TempDir
New-Item -ItemType Directory -Path $TempDir | Out-Null

$curl = (Get-Command curl.exe -ErrorAction Stop).Source
$rangeEnd = $ResumePrefixBytes - 1
& $curl `
    --fail `
    --location `
    --silent `
    --show-error `
    --retry 3 `
    --range "0-$rangeEnd" `
    --output $ArchivePath `
    ([string]$Config.archiveUrl)
Assert-LastExitCode "FFmpeg公式ZIPの先頭Range取得"

$prefixLength = (Get-Item -LiteralPath $ArchivePath).Length
if ($prefixLength -ne $ResumePrefixBytes) {
    throw "Range取得サイズが想定と異なります: $prefixLength / $ResumePrefixBytes bytes"
}

& $curl `
    --fail `
    --location `
    --silent `
    --show-error `
    --retry 3 `
    --continue-at - `
    --output $ArchivePath `
    ([string]$Config.archiveUrl)
Assert-LastExitCode "FFmpeg公式ZIPの再開取得"

$archiveItem = Get-Item -LiteralPath $ArchivePath
$archiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($archiveItem.Length -ne [long]$Config.archiveBytes) {
    throw "公式ZIPのサイズが監査値と一致しません: $($archiveItem.Length) / $($Config.archiveBytes) bytes"
}
if ($archiveHash -ne [string]$Config.archiveSha256) {
    throw "公式ZIPのSHA-256が監査値と一致しません: $archiveHash"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveFileName = [System.IO.Path]::GetFileName(([Uri][string]$Config.archiveUrl).AbsolutePath)
$archiveRoot = [System.IO.Path]::GetFileNameWithoutExtension($archiveFileName)
$entryName = "$archiveRoot/bin/ffmpeg.exe"
$zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq $entryName } | Select-Object -First 1
    if (-not $entry) {
        throw "監査対象FFmpegエントリが公式ZIPにありません: $entryName"
    }
    if ($entry.Length -ne [long]$Config.binaryBytes) {
        throw "展開対象FFmpegのサイズが監査値と一致しません: $($entry.Length) / $($Config.binaryBytes) bytes"
    }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $ExecutablePath, $true)
} finally {
    $zip.Dispose()
}

$executableItem = Get-Item -LiteralPath $ExecutablePath
$executableHash = (Get-FileHash -LiteralPath $ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($executableItem.Length -ne [long]$Config.binaryBytes) {
    throw "展開後FFmpegのサイズが監査値と一致しません: $($executableItem.Length) / $($Config.binaryBytes) bytes"
}
if ($executableHash -ne [string]$Config.binarySha256) {
    throw "展開後FFmpegのSHA-256が監査値と一致しません: $executableHash"
}

$versionLine = (& $ExecutablePath -version 2>&1 | Select-Object -First 1).ToString()
if ($versionLine -notmatch [regex]::Escape([string]$Config.binaryVersion)) {
    throw "展開後FFmpegのバージョンが監査値と一致しません: $versionLine"
}

$reportData = [ordered]@{
    status = "success"
    testedAt = [DateTimeOffset]::UtcNow.ToString("o")
    archiveUrl = [string]$Config.archiveUrl
    archiveBytes = $archiveItem.Length
    archiveSha256 = $archiveHash
    executableBytes = $executableItem.Length
    executableSha256 = $executableHash
    executableVersion = [string]$Config.binaryVersion
    archiveEntry = $entryName
    rangePrefixBytes = $ResumePrefixBytes
    rangeResumeVerified = $true
}
$reportParent = Split-Path -Parent $Report
if (-not (Test-Path -LiteralPath $reportParent -PathType Container)) {
    New-Item -ItemType Directory -Path $reportParent -Force | Out-Null
}
$reportData | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $Report -Encoding UTF8

Write-Host "FFMPEG OFFICIAL DOWNLOAD SMOKE: PASS" -ForegroundColor Green
Write-Host "URL: $($reportData.archiveUrl)"
Write-Host "Range resume: $($reportData.rangePrefixBytes) -> $($reportData.archiveBytes) bytes"
Write-Host "ZIP SHA-256: $($reportData.archiveSha256)"
Write-Host "EXE SHA-256: $($reportData.executableSha256)"
Write-Host "Version: $($reportData.executableVersion)"
Write-Host "Report: $Report"

if (-not $KeepDownload) {
    Remove-VerifiedDirectory $TempDir
}
