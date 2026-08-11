param(
    [string]$PythonPath = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path -LiteralPath (Join-Path $ScriptDir "..")).Path
Set-Location $RootDir

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $VenvPython = Join-Path $RootDir ".venv\Scripts\python.exe"
    $PythonPath = if (Test-Path -LiteralPath $VenvPython -PathType Leaf) { $VenvPython } else { "python" }
}

if (Test-Path -LiteralPath $PythonPath -PathType Leaf) {
    $ResolvedPython = (Resolve-Path -LiteralPath $PythonPath).Path
} else {
    $PythonCommand = Get-Command -Name $PythonPath -CommandType Application -ErrorAction SilentlyContinue
    if (-not $PythonCommand) { throw "Python was not found for the dependency license audit." }
    $ResolvedPython = $PythonCommand.Source
}

$PreviousPythonUtf8 = $env:PYTHONUTF8
try {
    $env:PYTHONUTF8 = "1"
    & $ResolvedPython (Join-Path $ScriptDir "dependency_license_audit.py")
    if ($LASTEXITCODE -ne 0) { throw "Dependency license audit failed." }
} finally {
    $env:PYTHONUTF8 = $PreviousPythonUtf8
}
