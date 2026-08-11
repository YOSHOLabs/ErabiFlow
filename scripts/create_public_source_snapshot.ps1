param(
    [Parameter(Mandatory = $true)]
    [string]$DestinationPath,
    [string]$AuthorName = "YOSHOLabs",
    [string]$AuthorEmail = "YOSHOLabs@users.noreply.github.com"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path -LiteralPath (Join-Path $ScriptDir "..")).Path
$Destination = [IO.Path]::GetFullPath($DestinationPath)
$SourceWithSeparator = $RootDir.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$DestinationWithSeparator = $Destination.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (Test-Path -LiteralPath $Destination) {
    throw "Destination already exists; refusing to overwrite it: $Destination"
}
if ($Destination.StartsWith($SourceWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination must be outside the old repository: $Destination"
}
if ($AuthorEmail -notmatch '^[^@\s]+@users\.noreply\.github\.com$') {
    throw "AuthorEmail must be a GitHub noreply identity."
}

$AllowedReleaseFiles = @(
    "release/ffmpeg-source.json",
    "release/metadata.json",
    "release/rustsec-allowed-warnings.json",
    "release/whisper-runtime.json"
)
$AllowedScriptFiles = @(
    "scripts/bootstrap_dev.ps1",
    "scripts/build_public_lite.ps1",
    "scripts/clean_stale_release_resources.ps1",
    "scripts/configure_update_endpoint.mjs",
    "scripts/create_public_source_snapshot.ps1",
    "scripts/dependency_audit.ps1",
    "scripts/dependency_license_audit.ps1",
    "scripts/dependency_license_audit.py",
    "scripts/desktop_daemon_smoke.mjs",
    "scripts/ffmpeg_official_download_smoke.ps1",
    "scripts/generate_dependency_license_bundle.py",
    "scripts/issue_creator_license.mjs",
    "scripts/light_release_check.ps1",
    "scripts/name_light_msi.ps1",
    "scripts/public_repo_check.ps1",
    "scripts/requirements-audit.txt"
)
$DeniedPatterns = @(
    '^(?:website|e2e-site|e2e-site-beta)/',
    '^playwright\.(?:site|beta-site)\.config\.ts$',
    '^src-tauri/tauri\.beta(?:\.offline)?\.conf\.json$',
    '^docs/(?:BETA_SMOKE_TEST|CLEAN_PC_RELEASE_CHECK|MONETIZATION_AND_PRODUCT_PLAN|PRODUCT_AND_RELEASE|VERTICAL_TRENDS_2026)\.md$',
    '^src/features/setup/BetaSmokeTestPanel\.tsx$',
    '^src/lib/(?:gearMonetizationConfig|publicReleaseConfig)(?:\.test)?\.ts$',
    '^build_release\.bat$'
)

Push-Location $RootDir
try {
    $Candidates = @(& git -c core.quotePath=false ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw "git ls-files failed." }

    $Included = [Collections.Generic.List[string]]::new()
    $Excluded = [Collections.Generic.List[string]]::new()
    foreach ($Candidate in $Candidates) {
        $RelativePath = $Candidate.Replace('\', '/')
        $SourcePath = Join-Path $RootDir $Candidate
        if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) { continue }

        $Deny = $false
        foreach ($Pattern in $DeniedPatterns) {
            if ($RelativePath -match $Pattern) { $Deny = $true; break }
        }
        if ($RelativePath.StartsWith('release/', [StringComparison]::OrdinalIgnoreCase) -and
            $RelativePath -notin $AllowedReleaseFiles) {
            $Deny = $true
        }
        if ($RelativePath.StartsWith('scripts/', [StringComparison]::OrdinalIgnoreCase) -and
            $RelativePath -notin $AllowedScriptFiles) {
            $Deny = $true
        }
        if ($Deny) {
            $Excluded.Add($RelativePath)
            continue
        }

        $SourceItem = Get-Item -LiteralPath $SourcePath -Force
        if (($SourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to copy a reparse point: $RelativePath"
        }
        $TargetPath = [IO.Path]::GetFullPath((Join-Path $Destination $RelativePath))
        if (-not $TargetPath.StartsWith($DestinationWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to copy outside destination: $RelativePath"
        }
        $TargetParent = Split-Path -Parent $TargetPath
        if (-not (Test-Path -LiteralPath $TargetParent -PathType Container)) {
            New-Item -ItemType Directory -Path $TargetParent -Force | Out-Null
        }
        Copy-Item -LiteralPath $SourcePath -Destination $TargetPath
        $Included.Add($RelativePath)
    }

    if ($Included.Count -eq 0) { throw "No public files were selected." }
    foreach ($Required in @('README.md', 'LICENSE', 'NOTICE', 'package.json', 'src-tauri/Cargo.toml')) {
        if ($Required -notin $Included) { throw "Required public file was not selected: $Required" }
    }

    & git -C $Destination init --initial-branch=main
    if ($LASTEXITCODE -ne 0) { throw "git init failed." }
    & git -C $Destination config user.name $AuthorName
    & git -C $Destination config user.email $AuthorEmail
    & git -C $Destination config commit.gpgsign false
    & git -C $Destination config tag.gpgsign false
    & git -C $Destination add --all
    if ($LASTEXITCODE -ne 0) { throw "git add failed." }
    & git -C $Destination commit -m "Initial public source release"
    if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
    & git -C $Destination remote add origin "https://github.com/YOSHOLabs/TateClip.git"
    if ($LASTEXITCODE -ne 0) { throw "git remote add failed." }

    $Commit = (& git -C $Destination rev-parse HEAD).Trim()
    $Bytes = (Get-ChildItem -LiteralPath $Destination -Recurse -File -Force |
        Where-Object { $_.FullName -notlike "$DestinationWithSeparator.git*" } |
        Measure-Object -Property Length -Sum).Sum
    Write-Host "PUBLIC SNAPSHOT: CREATED" -ForegroundColor Green
    Write-Host "Destination: $Destination"
    Write-Host "Commit: $Commit"
    Write-Host "Included files: $($Included.Count)"
    Write-Host "Excluded source files: $($Excluded.Count)"
    Write-Host ("Working tree size: {0:N2} MiB" -f ($Bytes / 1MB))
} finally {
    Pop-Location
}
