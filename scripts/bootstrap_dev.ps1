param(
    [switch]$SkipNpm,
    [switch]$SkipPython,
    [switch]$SkipWhisper
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path -LiteralPath (Join-Path $ScriptDir "..")).Path
Set-Location $RootDir

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $Hint"
    }
}

Require-Command "node" "Install the Node.js version recorded in .nvmrc."
Require-Command "npm" "Install npm 11 with Node.js 24."
Require-Command "cargo" "Install Rust through rustup; rust-toolchain.toml pins the project toolchain."

$NodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($NodeMajor -ne 24) {
    throw "TateClip development currently requires Node.js 24.x. Found: $(& node --version)"
}

if (-not $SkipNpm) {
    Write-Host "Installing JavaScript dependencies from package-lock.json..." -ForegroundColor Cyan
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
}

if (-not $SkipPython) {
    $VenvPython = Join-Path $RootDir ".venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
        $PythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
        if (-not $PythonCommand) { throw "Python 3.13 was not found. Install it before running setup:dev." }
        Write-Host "Creating the local Python environment..." -ForegroundColor Cyan
        & $PythonCommand.Source -m venv (Join-Path $RootDir ".venv")
        if ($LASTEXITCODE -ne 0) { throw "Python virtual environment creation failed." }
    }
    $PythonVersion = (& $VenvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
    if ($LASTEXITCODE -ne 0 -or $PythonVersion -ne "3.13") {
        throw "TateClip development currently requires a Python 3.13 virtual environment. Found: $PythonVersion"
    }
    & $VenvPython -m pip install --disable-pip-version-check --require-hashes -r (Join-Path $RootDir "python-sidecar\requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }

    $AuditVenvPython = Join-Path $RootDir ".audit-venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $AuditVenvPython -PathType Leaf)) {
        Write-Host "Creating the isolated dependency-audit environment..." -ForegroundColor Cyan
        & $VenvPython -m venv (Join-Path $RootDir ".audit-venv")
        if ($LASTEXITCODE -ne 0) { throw "Python dependency-audit environment creation failed." }
    }
    $AuditPythonVersion = (& $AuditVenvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
    if ($LASTEXITCODE -ne 0 -or $AuditPythonVersion -ne "3.13") {
        throw "TateClip dependency auditing currently requires Python 3.13. Found: $AuditPythonVersion"
    }
    & $AuditVenvPython -m pip install --disable-pip-version-check --require-hashes -r (Join-Path $RootDir "scripts\requirements-audit.txt")
    if ($LASTEXITCODE -ne 0) { throw "Python dependency-audit tool installation failed." }
}

if (-not $SkipWhisper) {
    $WhisperDir = Join-Path $RootDir "python-sidecar\whisper-cpp"
    $WhisperCli = Join-Path $WhisperDir "whisper-cli.exe"
    $VadModel = Join-Path $WhisperDir "ggml-silero-v6.2.0.bin"
    $RuntimeConfig = Get-Content -LiteralPath (Join-Path $RootDir "release\whisper-runtime.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $WhisperArchiveUrl = [string]$RuntimeConfig.archiveUrl
    $WhisperArchiveSha256 = [string]$RuntimeConfig.archiveSha256
    $VadModelUrl = [string]$RuntimeConfig.vadModelUrl
    $VadModelSha256 = [string]$RuntimeConfig.vadModelSha256
    if ($RuntimeConfig.configuration -ne "official-windows-x64-cpu" -or
        $WhisperArchiveUrl -notmatch '^https://github\.com/ggml-org/whisper\.cpp/releases/download/' -or
        $VadModelUrl -notmatch '^https://raw\.githubusercontent\.com/ggml-org/whisper\.cpp/') {
        throw "release/whisper-runtime.json does not describe an approved official runtime."
    }

    $ExpectedRuntimeNames = @("whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll")
    $RuntimeFiles = @($RuntimeConfig.runtimeFiles)
    $ConfiguredRuntimeNames = @($RuntimeFiles | ForEach-Object { [string]$_.name } | Sort-Object)
    $SortedExpectedRuntimeNames = @($ExpectedRuntimeNames | Sort-Object)
    if ($RuntimeFiles.Count -ne $ExpectedRuntimeNames.Count -or
        ($ConfiguredRuntimeNames -join ',') -ne ($SortedExpectedRuntimeNames -join ',')) {
        throw "release/whisper-runtime.json does not list the exact CPU runtime files."
    }

    $RuntimeValid = $true
    foreach ($RuntimeFile in $RuntimeFiles) {
        $RuntimePath = Join-Path $WhisperDir ([string]$RuntimeFile.name)
        if (-not (Test-Path -LiteralPath $RuntimePath -PathType Leaf)) {
            $RuntimeValid = $false
            break
        }
        $RuntimeItem = Get-Item -LiteralPath $RuntimePath
        $RuntimeHash = (Get-FileHash -LiteralPath $RuntimePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($RuntimeItem.Length -ne [long]$RuntimeFile.bytes -or $RuntimeHash -ne [string]$RuntimeFile.sha256) {
            $RuntimeValid = $false
            break
        }
    }

    if (-not $RuntimeValid) {
        $RunId = [Guid]::NewGuid().ToString('N')
        $TempRoot = [IO.Path]::GetFullPath((Join-Path $RootDir ".tmp-whisper-$RunId"))
        $RootPrefix = $RootDir.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        if (-not $TempRoot.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Unexpected temporary path: $TempRoot"
        }
        New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
        try {
            $ArchivePath = Join-Path $TempRoot "whisper-bin-x64.zip"
            Write-Host "Downloading the pinned whisper.cpp v1.8.3 runtime..." -ForegroundColor Cyan
            Invoke-WebRequest -Uri $WhisperArchiveUrl -OutFile $ArchivePath
            $ArchiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($ArchiveHash -ne $WhisperArchiveSha256) { throw "whisper.cpp archive SHA-256 mismatch." }
            $Extracted = Join-Path $TempRoot "extracted"
            Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Extracted
            New-Item -ItemType Directory -Path $WhisperDir -Force | Out-Null
            foreach ($RuntimeFile in $RuntimeFiles) {
                $Name = [string]$RuntimeFile.name
                $Source = Get-ChildItem -LiteralPath $Extracted -Recurse -File -Filter $Name | Select-Object -First 1
                if (-not $Source) { throw "The whisper.cpp archive did not contain $Name." }
                $SourceHash = (Get-FileHash -LiteralPath $Source.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($Source.Length -ne [long]$RuntimeFile.bytes -or $SourceHash -ne [string]$RuntimeFile.sha256) {
                    throw "The extracted whisper.cpp runtime did not match the pinned file: $Name"
                }
                Copy-Item -LiteralPath $Source.FullName -Destination (Join-Path $WhisperDir $Name) -Force
            }
        }
        finally {
            if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force }
        }
    }

    $VadValid = $false
    if (Test-Path -LiteralPath $VadModel -PathType Leaf) {
        $ActualVadHash = (Get-FileHash -LiteralPath $VadModel -Algorithm SHA256).Hash.ToLowerInvariant()
        $VadValid = (Get-Item -LiteralPath $VadModel).Length -eq [long]$RuntimeConfig.vadModelBytes -and
            $ActualVadHash -eq $VadModelSha256
    }
    if (-not $VadValid) {
        New-Item -ItemType Directory -Path $WhisperDir -Force | Out-Null
        $VadTemp = Join-Path $WhisperDir (".ggml-silero-v6.2.0-{0}.part" -f [Guid]::NewGuid().ToString('N'))
        try {
            Write-Host "Downloading the pinned Silero VAD model..." -ForegroundColor Cyan
            Invoke-WebRequest -Uri $VadModelUrl -OutFile $VadTemp
            if ((Get-Item -LiteralPath $VadTemp).Length -ne [long]$RuntimeConfig.vadModelBytes) {
                throw "Silero VAD model size mismatch."
            }
            $ActualVadHash = (Get-FileHash -LiteralPath $VadTemp -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($ActualVadHash -ne $VadModelSha256) { throw "Silero VAD model SHA-256 mismatch." }
            Move-Item -LiteralPath $VadTemp -Destination $VadModel -Force
        }
        finally {
            if (Test-Path -LiteralPath $VadTemp) { Remove-Item -LiteralPath $VadTemp -Force }
        }
    }
}

Write-Host "Development setup is ready. Run: npm run tauri dev" -ForegroundColor Green
Write-Host "FFmpeg is downloaded and verified by TateClip on first use; it is not stored in Git." -ForegroundColor Green
