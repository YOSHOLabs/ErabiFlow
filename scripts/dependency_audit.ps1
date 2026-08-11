param(
    [string]$CargoAuditPath = "cargo-audit",
    [string]$PythonPath = "",
    [string]$AdvisoryDbPath = "",
    [string]$WarningAllowlistPath = ".\release\rustsec-allowed-warnings.json",
    [string]$ReportPath = ".\release\dependency-audit.local.json",
    [switch]$NoFetch
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RootDir

function Get-LockHash([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Lock file is missing: $Path"
    }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Convert-CommandJson([string]$Name, [string[]]$Lines) {
    $Text = ($Lines -join [Environment]::NewLine).Trim()
    $JsonStart = $Text.IndexOf('{')
    $JsonEnd = $Text.LastIndexOf('}')
    if ($JsonStart -lt 0 -or $JsonEnd -lt $JsonStart) {
        throw "$Name did not return a JSON object."
    }
    $Text = $Text.Substring($JsonStart, $JsonEnd - $JsonStart + 1)
    try {
        return $Text | ConvertFrom-Json
    } catch {
        throw "$Name did not return valid JSON: $($_.Exception.Message)"
    }
}

Write-Host "Auditing production npm dependencies..." -ForegroundColor Cyan
$npmOutput = @(& npm audit --omit=dev --json 2>&1 | ForEach-Object { [string]$_ })
$npmExitCode = $LASTEXITCODE
$npmAudit = Convert-CommandJson "npm audit" $npmOutput
$npmVulnerabilityCount = [int]$npmAudit.metadata.vulnerabilities.total

Write-Host "Auditing Python build dependencies..." -ForegroundColor Cyan
if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $auditVenvPython = Join-Path $RootDir ".audit-venv\Scripts\python.exe"
    $PythonPath = if (Test-Path -LiteralPath $auditVenvPython -PathType Leaf) { $auditVenvPython } else { "python" }
}
$resolvedPython = $null
if (Test-Path -LiteralPath $PythonPath -PathType Leaf) {
    $resolvedPython = (Resolve-Path -LiteralPath $PythonPath).Path
} else {
    $pythonCommand = Get-Command -Name $PythonPath -CommandType Application -ErrorAction SilentlyContinue
    if ($pythonCommand) { $resolvedPython = $pythonCommand.Source }
}
if (-not $resolvedPython) {
    throw "Python is required for the dependency audit."
}
$previousPythonUtf8 = $env:PYTHONUTF8
try {
    # pip-requirements-parser otherwise decodes UTF-8 comments with the Windows ANSI code page.
    $env:PYTHONUTF8 = "1"
    $pipAuditOutput = @(& $resolvedPython -m pip_audit -r ".\python-sidecar\requirements.txt" --strict --format json 2>&1 | ForEach-Object { [string]$_ })
    $pipAuditExitCode = $LASTEXITCODE
    $pipToolAuditOutput = @(& $resolvedPython -m pip_audit --strict --format json 2>&1 | ForEach-Object { [string]$_ })
    $pipToolAuditExitCode = $LASTEXITCODE
} finally {
    $env:PYTHONUTF8 = $previousPythonUtf8
}
if (-not $pipAuditOutput) {
    throw "pip-audit is required. Install it once with: python -m pip install pip-audit==2.10.1"
}
$pipAudit = Convert-CommandJson "pip-audit" $pipAuditOutput
$pythonVulnerabilityCount = @(
    $pipAudit.dependencies | ForEach-Object { @($_.vulns) }
).Count
$pipToolAudit = Convert-CommandJson "pip-audit tool environment" $pipToolAuditOutput
$pythonAuditToolVulnerabilityCount = @(
    $pipToolAudit.dependencies | ForEach-Object { @($_.vulns) }
).Count

Write-Host "Auditing Windows Rust dependencies..." -ForegroundColor Cyan
$resolvedCargoAudit = $null
if (Test-Path -LiteralPath $CargoAuditPath -PathType Leaf) {
    $resolvedCargoAudit = (Resolve-Path -LiteralPath $CargoAuditPath).Path
} else {
    $cargoAuditCommand = Get-Command -Name $CargoAuditPath -CommandType Application -ErrorAction SilentlyContinue
    if ($cargoAuditCommand) {
        $resolvedCargoAudit = $cargoAuditCommand.Source
    }
}
if (-not $resolvedCargoAudit) {
    throw "cargo-audit is required. Install it once with: cargo install cargo-audit --locked"
}

$cargoAuditArgs = @(
    "audit",
    "--json",
    "--target-os", "windows",
    "--target-arch", "x86_64"
)
if ($NoFetch) {
    $cargoAuditArgs += "--no-fetch"
}
if (-not [string]::IsNullOrWhiteSpace($AdvisoryDbPath)) {
    $cargoAuditArgs += @("--db", $AdvisoryDbPath)
}

$cargoDirectory = Join-Path $RootDir "src-tauri"
Push-Location $cargoDirectory
try {
    $cargoOutput = @(& $resolvedCargoAudit @cargoAuditArgs 2>&1 | ForEach-Object { [string]$_ })
    $cargoExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
$cargoAudit = Convert-CommandJson "cargo audit" $cargoOutput
$cargoVulnerabilityCount = @($cargoAudit.vulnerabilities.list).Count

$warningKinds = @()
$warningEntries = @()
$cargoWarningCount = 0
if ($cargoAudit.warnings) {
    foreach ($warningProperty in $cargoAudit.warnings.PSObject.Properties) {
        $count = @($warningProperty.Value).Count
        $cargoWarningCount += $count
        $warningKinds += [ordered]@{
            kind = [string]$warningProperty.Name
            count = $count
        }
        foreach ($warning in @($warningProperty.Value)) {
            $warningEntries += [ordered]@{
                kind = [string]$warningProperty.Name
                advisoryId = [string]$warning.advisory.id
                package = [string]$warning.package.name
                version = [string]$warning.package.version
            }
        }
    }
}

$resolvedAllowlistPath = [System.IO.Path]::GetFullPath((Join-Path $RootDir $WarningAllowlistPath))
if (-not (Test-Path -LiteralPath $resolvedAllowlistPath -PathType Leaf)) {
    throw "RustSec warning allowlist is missing: $resolvedAllowlistPath"
}
$warningAllowlist = Get-Content -LiteralPath $resolvedAllowlistPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$warningAllowlist.schemaVersion -ne 1 -or [string]$warningAllowlist.target -ne "windows-x64") {
    throw "RustSec warning allowlist must be schemaVersion 1 for windows-x64."
}

function Get-WarningKey($Entry) {
    return "$([string]$Entry.kind)|$([string]$Entry.advisoryId)|$([string]$Entry.package)|$([string]$Entry.version)"
}

$allowlistEntries = @($warningAllowlist.entries)
$allowlistKeys = @($allowlistEntries | ForEach-Object { Get-WarningKey $_ })
if (@($allowlistKeys | Select-Object -Unique).Count -ne $allowlistKeys.Count) {
    throw "RustSec warning allowlist contains duplicate entries."
}
$actualWarningKeys = @($warningEntries | ForEach-Object { Get-WarningKey $_ })
$unknownWarnings = @($warningEntries | Where-Object { $allowlistKeys -notcontains (Get-WarningKey $_) })
$staleAllowances = @($allowlistEntries | Where-Object { $actualWarningKeys -notcontains (Get-WarningKey $_) })
$warningsExactlyAllowed = $unknownWarnings.Count -eq 0 -and $staleAllowances.Count -eq 0

$auditSucceeded = $npmExitCode -eq 0 -and $pipAuditExitCode -eq 0 -and $pipToolAuditExitCode -eq 0 -and $cargoExitCode -eq 0 -and $npmVulnerabilityCount -eq 0 -and $pythonVulnerabilityCount -eq 0 -and $pythonAuditToolVulnerabilityCount -eq 0 -and $cargoVulnerabilityCount -eq 0 -and $warningsExactlyAllowed
$report = [ordered]@{
    schemaVersion = 1
    status = if ($auditSucceeded) { "success" } else { "failed" }
    auditedAt = [DateTimeOffset]::UtcNow.ToString("o")
    npm = [ordered]@{
        lockFile = "package-lock.json"
        lockSha256 = Get-LockHash ".\package-lock.json"
        productionVulnerabilityCount = $npmVulnerabilityCount
        exitCode = $npmExitCode
    }
    python = [ordered]@{
        requirementsFile = "python-sidecar/requirements.txt"
        requirementsSha256 = Get-LockHash ".\python-sidecar\requirements.txt"
        auditToolRequirementsFile = "scripts/requirements-audit.txt"
        auditToolRequirementsSha256 = Get-LockHash ".\scripts\requirements-audit.txt"
        vulnerabilityCount = $pythonVulnerabilityCount
        exitCode = $pipAuditExitCode
        auditToolVulnerabilityCount = $pythonAuditToolVulnerabilityCount
        auditToolExitCode = $pipToolAuditExitCode
    }
    cargo = [ordered]@{
        lockFile = "src-tauri/Cargo.lock"
        lockSha256 = Get-LockHash ".\src-tauri\Cargo.lock"
        targetOs = "windows"
        targetArch = "x86_64"
        vulnerabilityCount = $cargoVulnerabilityCount
        allowedWarningCount = $cargoWarningCount
        warningKinds = $warningKinds
        warningEntries = $warningEntries
        warningAllowlistFile = "release/rustsec-allowed-warnings.json"
        warningAllowlistSha256 = (Get-FileHash -LiteralPath $resolvedAllowlistPath -Algorithm SHA256).Hash.ToLowerInvariant()
        unknownWarningCount = $unknownWarnings.Count
        staleAllowanceCount = $staleAllowances.Count
        exitCode = $cargoExitCode
    }
}

$resolvedReportPath = [System.IO.Path]::GetFullPath((Join-Path $RootDir $ReportPath))
$releaseDir = Join-Path $RootDir "release"
if (-not $resolvedReportPath.StartsWith($releaseDir, [StringComparison]::OrdinalIgnoreCase)) {
    throw "ReportPath must stay inside the release directory."
}
New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedReportPath) -Force | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

Write-Host "npm production vulnerabilities: $npmVulnerabilityCount"
Write-Host "Python build dependency vulnerabilities: $pythonVulnerabilityCount"
Write-Host "Python audit-tool dependency vulnerabilities: $pythonAuditToolVulnerabilityCount"
Write-Host "Rust vulnerabilities (Windows x64): $cargoVulnerabilityCount"
Write-Host "Rust allowed warnings: $cargoWarningCount"
Write-Host "Rust unknown warnings: $($unknownWarnings.Count)"
Write-Host "Rust stale allowances: $($staleAllowances.Count)"
Write-Host "Report: $resolvedReportPath"

if (-not $auditSucceeded) {
    throw "Dependency audit failed."
}

Write-Host "DEPENDENCY AUDIT: PASS" -ForegroundColor Green
