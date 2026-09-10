param(
    [switch]$AllowDirty,
    [switch]$InitialPublication
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path -LiteralPath (Join-Path $ScriptDir "..")).Path
Set-Location $RootDir

$Failures = [Collections.Generic.List[string]]::new()
function Add-Failure([string]$Message) { $Failures.Add($Message) }

function Get-NormalizedGitHubRepository([string]$RemoteUrl) {
    try {
        $Uri = [Uri]::new($RemoteUrl, [UriKind]::Absolute)
    } catch {
        return $null
    }

    if ($Uri.Scheme -ne 'https' -or
        $Uri.Host -ne 'github.com' -or
        -not $Uri.IsDefaultPort -or
        $Uri.UserInfo -or
        $Uri.Query -or
        $Uri.Fragment) {
        return $null
    }

    $RepositoryPath = $Uri.AbsolutePath.TrimEnd('/')
    if ($RepositoryPath.Length -le 1 -or
        -not $RepositoryPath.StartsWith('/') -or
        $RepositoryPath.StartsWith('//')) {
        return $null
    }

    $Repository = $RepositoryPath.Substring(1)
    if ($Repository.EndsWith('.git', [StringComparison]::OrdinalIgnoreCase)) {
        $Repository = $Repository.Substring(0, $Repository.Length - 4)
    }

    if (($Repository -split '/').Count -ne 2) {
        return $null
    }

    return $Repository
}

foreach ($Required in @(
    "README.md",
    "LICENSE",
    "NOTICE",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "TRADEMARKS.md",
    ".gitignore",
    ".gitattributes",
    ".gitleaks.toml",
    ".github\workflows\ci.yml",
    "docs\THIRD_PARTY_PROVENANCE.md"
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $RootDir $Required) -PathType Leaf)) {
        Add-Failure "Required public repository file is missing: $Required"
    }
}

$Candidates = @(& git -c core.quotePath=false ls-files --cached --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw "git ls-files failed." }
$ForbiddenExtensions = @('.key', '.pfx', '.p12', '.dpapi', '.jks', '.keystore', '.msi', '.exe', '.dll', '.bin', '.zip', '.7z', '.rar', '.cer', '.crt')
$ForbiddenNames = @('.env', '.npmrc', '.pypirc', 'id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json')
$TextExtensions = @('.bat', '.cmd', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.py', '.rs', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yml', '.yaml')
$SecretPatterns = @(
    '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    '\bAKIA[0-9A-Z]{16}\b',
    '\bgh[pousr]_[A-Za-z0-9_]{30,}\b',
    '\bgithub_pat_[A-Za-z0-9_]{20,}\b',
    '\bsk-[A-Za-z0-9_-]{20,}\b',
    '\bxox[baprs]-[A-Za-z0-9-]{10,}\b'
)
$PersonalPathPattern = 'C:' + '\\Users\\' + '[^\\\s]+\\'
$PrivateEmailPattern = '\b[A-Z0-9._%+-]+@(?:gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|yahoo\.[a-z.]+|icloud\.com)\b'
$AllowedReleasePaths = @(
    'release/ffmpeg-source.json',
    'release/metadata.json',
    'release/RELEASE_NOTES_0.1.0.md',
    'release/SHA256SUMS.txt',
    'release/rustsec-allowed-warnings.json',
    'release/whisper-runtime.json'
)
$AllowedScriptPaths = @(
    'scripts/bootstrap_dev.ps1',
    'scripts/build_public_lite.ps1',
    'scripts/capture_portfolio_screenshots.mjs',
    'scripts/clean_stale_release_resources.ps1',
    'scripts/configure_update_endpoint.mjs',
    'scripts/create_public_source_snapshot.ps1',
    'scripts/dependency_audit.ps1',
    'scripts/dependency_license_audit.ps1',
    'scripts/dependency_license_audit.py',
    'scripts/desktop_daemon_smoke.mjs',
    'scripts/ffmpeg_official_download_smoke.ps1',
    'scripts/generate_dependency_license_bundle.py',
    'scripts/issue_creator_license.mjs',
    'scripts/light_release_check.ps1',
    'scripts/name_light_msi.ps1',
    'scripts/public_repo_check.ps1',
    'scripts/requirements-audit.txt'
)
$ForbiddenPublicPaths = @(
    '^(?:website|e2e-site|e2e-site-beta)[\\/]',
    '^playwright\.(?:site|beta-site)\.config\.ts$',
    '^src-tauri[\\/]tauri\.beta(?:\.offline)?\.conf\.json$',
    '^docs[\\/](?:BETA_SMOKE_TEST|CLEAN_PC_RELEASE_CHECK|MONETIZATION_AND_PRODUCT_PLAN|PRODUCT_AND_RELEASE|VERTICAL_TRENDS_2026)\.md$',
    '^src[\\/]features[\\/]setup[\\/]BetaSmokeTestPanel\.tsx$',
    '^src[\\/]lib[\\/](?:gearMonetizationConfig|publicReleaseConfig)(?:\.test)?\.ts$',
    '^release[\\/](?:beta-|channels\.json$|distribution\.json$|gear-links\.json$|policy\.json$|signoff\.)',
    '^scripts[\\/](?:.*beta.*|.*site.*|configure_gear_monetization|configure_public_release|package_clean_pc_test_kit|public_release_check|record_release_signoff|stage_|upload_|write_beta_distribution)',
    '^(?:\.vscode|\.idea|\.vs)[\\/]',
    '^build_release\.bat$'
)

foreach ($RelativePath in $Candidates) {
    $FullPath = Join-Path $RootDir $RelativePath
    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) { continue }
    $NormalizedPath = $RelativePath.Replace('\', '/')
    $File = Get-Item -LiteralPath $FullPath
    if ($File.Length -ge 25MB) {
        Add-Failure "File is too large for ordinary Git tracking: $RelativePath ($([math]::Round($File.Length / 1MB, 2)) MiB)"
    }
    $Extension = [IO.Path]::GetExtension($RelativePath).ToLowerInvariant()
    $Name = [IO.Path]::GetFileName($RelativePath).ToLowerInvariant()
    if ($ForbiddenNames -contains $Name -and $RelativePath -ne '.env.example') {
        Add-Failure "Credential-bearing filename must not be committed: $RelativePath"
    }
    if ($ForbiddenExtensions -contains $Extension) {
        Add-Failure "Generated binary or credential-like file must not be committed: $RelativePath"
    }
    foreach ($Pattern in $ForbiddenPublicPaths) {
        if ($RelativePath -match $Pattern) {
            Add-Failure "File is outside the public source repository scope: $RelativePath"
            break
        }
    }
    if ($NormalizedPath.StartsWith('release/', [StringComparison]::OrdinalIgnoreCase) -and $NormalizedPath -notin $AllowedReleasePaths) {
        Add-Failure "Release file is outside the public source allowlist: $RelativePath"
    }
    if ($NormalizedPath.StartsWith('scripts/', [StringComparison]::OrdinalIgnoreCase) -and $NormalizedPath -notin $AllowedScriptPaths) {
        Add-Failure "Script is outside the public source allowlist: $RelativePath"
    }
    if ($TextExtensions -contains $Extension -and $File.Length -le 5MB) {
        $Text = Get-Content -LiteralPath $FullPath -Raw -ErrorAction SilentlyContinue
        if ($null -eq $Text) { continue }
        foreach ($Pattern in $SecretPatterns) {
            if ($Text -match $Pattern) {
                Add-Failure "High-confidence credential pattern found in: $RelativePath"
                break
            }
        }
        if ($Text -match $PersonalPathPattern) {
            Add-Failure "Machine-specific Windows user path found in: $RelativePath"
        }
        if ($Text -match $PrivateEmailPattern) {
            Add-Failure "Personal email address found in public file: $RelativePath"
        }
    }
}

$UnexpectedModes = @(& git ls-files --stage | Where-Object { $_ -match '^(120000|160000) ' })
foreach ($Entry in $UnexpectedModes) {
    Add-Failure "Symlinks and Git submodules require explicit public review and are currently forbidden: $Entry"
}

$PrivateCommitEmailPattern = '@(?:gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|yahoo\.[a-z.]+|icloud\.com)$'
$CommitEmails = @(& git log HEAD --format='%ae%n%ce' 2>$null | Sort-Object -Unique)
foreach ($Email in $CommitEmails) {
    if ($Email -match $PrivateCommitEmailPattern) {
        Add-Failure "Reachable Git history contains a personal email address. Rebuild the public history with a project/noreply identity: $Email"
    }
    if ($InitialPublication -and $Email -notmatch '@users\.noreply\.github\.com$') {
        Add-Failure "Initial public history must use a GitHub noreply author and committer identity: $Email"
    }
}

$CargoToml = Get-Content -LiteralPath (Join-Path $RootDir 'src-tauri\Cargo.toml') -Raw
if ($CargoToml -notmatch '(?m)^repository\s*=\s*"https://github\.com/YOSHOLabs/ErabiFlow"\s*$') {
    Add-Failure "src-tauri/Cargo.toml must identify YOSHOLabs/ErabiFlow."
}
if ($CargoToml -match '(?m)^license\s*=' -or $CargoToml -notmatch '(?m)^license-file\s*=\s*"\.\./LICENSE"\s*$') {
    Add-Failure "src-tauri/Cargo.toml must use the custom root LICENSE and no OSS license identifier."
}
$PackageJson = Get-Content -LiteralPath (Join-Path $RootDir 'package.json') -Raw | ConvertFrom-Json
if ($PackageJson.license -ne 'UNLICENSED' -or $PackageJson.repository.url -ne 'git+https://github.com/YOSHOLabs/ErabiFlow.git') {
    Add-Failure "package.json must declare UNLICENSED and YOSHOLabs/ErabiFlow."
}
$MediaPipePackagePath = Join-Path $RootDir 'node_modules\@mediapipe\tasks-vision\package.json'
if (-not (Test-Path -LiteralPath $MediaPipePackagePath -PathType Leaf)) {
    Add-Failure 'MediaPipe dependency is not installed. Run npm ci before the repository checker.'
} else {
    $MediaPipePackage = Get-Content -LiteralPath $MediaPipePackagePath -Raw | ConvertFrom-Json
    $MediaPipeVersion = [string]$MediaPipePackage.version
    foreach ($Name in @(
        'vision_wasm_internal.js',
        'vision_wasm_internal.wasm',
        'vision_wasm_nosimd_internal.js',
        'vision_wasm_nosimd_internal.wasm'
    )) {
        $TrackedWasm = Join-Path $RootDir "public\mediapipe-wasm\$Name"
        $InstalledWasm = Join-Path $RootDir "node_modules\@mediapipe\tasks-vision\wasm\$Name"
        if (-not (Test-Path -LiteralPath $TrackedWasm -PathType Leaf) -or
            -not (Test-Path -LiteralPath $InstalledWasm -PathType Leaf)) {
            Add-Failure "MediaPipe runtime file is missing: $Name"
            continue
        }
        $TrackedHash = (Get-FileHash -LiteralPath $TrackedWasm -Algorithm SHA256).Hash
        $InstalledHash = (Get-FileHash -LiteralPath $InstalledWasm -Algorithm SHA256).Hash
        if ($TrackedHash -ne $InstalledHash) {
            Add-Failure "Tracked MediaPipe runtime does not match @mediapipe/tasks-vision ${MediaPipeVersion}: $Name"
        }
    }

    $ProvenanceText = Get-Content -LiteralPath (Join-Path $RootDir 'docs\THIRD_PARTY_PROVENANCE.md') -Raw
    $NoticeText = Get-Content -LiteralPath (Join-Path $RootDir 'src-tauri\resources\THIRD_PARTY_NOTICES.txt') -Raw
    if ($ProvenanceText -notmatch [regex]::Escape("@mediapipe/tasks-vision@${MediaPipeVersion}/wasm")) {
        Add-Failure "MediaPipe provenance does not identify @mediapipe/tasks-vision ${MediaPipeVersion}."
    }
    if ($NoticeText -notmatch [regex]::Escape("@mediapipe/tasks-vision ${MediaPipeVersion}")) {
        Add-Failure "Third-party notices do not identify @mediapipe/tasks-vision ${MediaPipeVersion}."
    }
}
$LicenseText = Get-Content -LiteralPath (Join-Path $RootDir 'LICENSE') -Raw
if ($LicenseText -notmatch 'All Rights Reserved' -or $LicenseText -notmatch 'not open-source software' -or $LicenseText -notmatch 'YOSHOLabs') {
    Add-Failure "LICENSE must clearly identify the custom non-OSS, all-rights-reserved terms."
}

$UnexpectedRefs = @(& git for-each-ref --format='%(refname)' 'refs/codex/**')
foreach ($Ref in $UnexpectedRefs) { Add-Failure "Local-only Codex ref must not be mirror-pushed: $Ref" }

$Tags = @(& git tag --list)
if ($InitialPublication -and $Tags.Count -gt 0) {
    Add-Failure "Initial public history must not contain tags: $($Tags -join ', ')"
}
if ($InitialPublication) {
    $CommitCount = [int](& git rev-list --count HEAD)
    if ($CommitCount -ne 1) { Add-Failure "Initial public history must contain exactly one commit; found $CommitCount." }
    $HeadWithParents = [string](& git rev-list --parents --max-count=1 HEAD)
    if (($HeadWithParents -split '\s+').Count -ne 1) { Add-Failure "Initial public commit must not have a parent." }
    $UnexpectedBranches = @(& git for-each-ref --format='%(refname)' 'refs/heads/**' | Where-Object { $_ -ne 'refs/heads/main' })
    foreach ($Ref in $UnexpectedBranches) { Add-Failure "Initial public repository has an unexpected branch: $Ref" }
    $Unreachable = @(& git fsck --full --unreachable --no-reflogs 2>$null | Where-Object { $_ -match '^unreachable ' })
    foreach ($Object in $Unreachable) { Add-Failure "Initial public repository contains an unreachable old object: $Object" }
}

$ExpectedRepository = 'YOSHOLabs/ErabiFlow'
if ($env:GITHUB_ACTIONS -eq 'true') {
    $GitHubServerUrl = $null
    try {
        $GitHubServerUrl = [Uri]::new($env:GITHUB_SERVER_URL, [UriKind]::Absolute)
    } catch {
        Add-Failure 'GITHUB_SERVER_URL is missing or invalid in GitHub Actions.'
    }

    if ($GitHubServerUrl -and (
        $GitHubServerUrl.Scheme -ne 'https' -or
        $GitHubServerUrl.Host -ne 'github.com' -or
        -not $GitHubServerUrl.IsDefaultPort -or
        $GitHubServerUrl.UserInfo -or
        $GitHubServerUrl.Query -or
        $GitHubServerUrl.Fragment -or
        $GitHubServerUrl.AbsolutePath.Trim('/')
    )) {
        Add-Failure 'GITHUB_SERVER_URL must identify https://github.com.'
    }

    if ($env:GITHUB_REPOSITORY -ine $ExpectedRepository) {
        Add-Failure 'GITHUB_REPOSITORY must identify YOSHOLabs/ErabiFlow.'
    } else {
        $ExpectedRepository = $env:GITHUB_REPOSITORY
    }
}

$RemoteUrl = [string](& git remote get-url origin 2>$null)
if (-not $RemoteUrl) {
    Add-Failure "Git remote 'origin' is not configured."
} else {
    $RemoteRepository = Get-NormalizedGitHubRepository $RemoteUrl
    if (-not $RemoteRepository -or $RemoteRepository -ine $ExpectedRepository) {
        Add-Failure "Git remote 'origin' must securely identify https://github.com/YOSHOLabs/ErabiFlow."
    }
}

if (-not $AllowDirty) {
    $Dirty = @(& git status --porcelain=v1)
    if ($Dirty.Count -gt 0) { Add-Failure "Working tree is not clean. Commit or remove all intended public changes first." }
}

$DiffCheck = & git diff --check 2>&1
if ($LASTEXITCODE -ne 0) { Add-Failure "git diff --check failed:`n$($DiffCheck -join "`n")" }

if ($Failures.Count -gt 0) {
    Write-Host "PUBLIC REPOSITORY CHECK: FAIL" -ForegroundColor Red
    foreach ($Failure in $Failures) { Write-Host "- $Failure" -ForegroundColor Red }
    exit 1
}

Write-Host "PUBLIC REPOSITORY CHECK: PASS" -ForegroundColor Green
Write-Host "This check complements, but does not replace, a full-history gitleaks scan and GitHub branch protection."
