@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo [ErabiFlow] Building gemma_daemon.exe

set "PYTHON_EXE="
if exist "..\.venv\Scripts\python.exe" set "PYTHON_EXE=..\.venv\Scripts\python.exe"
if not defined PYTHON_EXE (
    for /f "delims=" %%P in ('where python 2^>nul') do (
        if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
    )
)

if not defined PYTHON_EXE (
    echo [ERROR] Python was not found.
    echo [HINT] Install Python 3.10+ or create a local .venv in the project root.
    exit /b 1
)

"%PYTHON_EXE%" -m PyInstaller --version >nul 2>nul
if errorlevel 1 (
    echo [ERROR] PyInstaller was not found for: %PYTHON_EXE%
    echo [HINT] Run: %PYTHON_EXE% -m pip install --require-hashes -r requirements.txt
    exit /b 1
)

if not exist "build_daemon.spec" (
    echo [ERROR] build_daemon.spec was not found. Run this script from python-sidecar.
    exit /b 1
)

echo [Step 1/5] Running PyInstaller...
"%PYTHON_EXE%" -m PyInstaller --clean --noconfirm build_daemon.spec
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    exit /b 1
)

if not exist "dist\gemma_daemon\gemma_daemon.exe" (
    echo [ERROR] PyInstaller output was not found: dist\gemma_daemon\gemma_daemon.exe
    exit /b 1
)

echo [Step 2/5] Copying runtime license texts...
"%PYTHON_EXE%" copy_runtime_licenses.py "dist\gemma_daemon\licenses"
if errorlevel 1 (
    echo [ERROR] Failed to copy Python build dependency license texts.
    exit /b 1
)

echo [Step 3/5] Generating the dependency license bundle...
"%PYTHON_EXE%" "..\scripts\generate_dependency_license_bundle.py"
if errorlevel 1 (
    echo [ERROR] Failed to generate the dependency license bundle.
    exit /b 1
)

echo [Step 4/5] Copying daemon bundle into Tauri resources...
set "TARGET_DIR=..\src-tauri\binaries"
set "SIDECAR_DIR=%TARGET_DIR%\gemma_daemon-x86_64-pc-windows-msvc"

for %%I in ("%TARGET_DIR%") do set "TARGET_DIR_ABS=%%~fI"
for %%I in ("%SIDECAR_DIR%") do set "SIDECAR_DIR_ABS=%%~fI"
if /I not "%SIDECAR_DIR_ABS%"=="%TARGET_DIR_ABS%\gemma_daemon-x86_64-pc-windows-msvc" (
    echo [ERROR] Refusing to replace an unexpected daemon directory: %SIDECAR_DIR_ABS%
    exit /b 1
)

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
if exist "%SIDECAR_DIR_ABS%" rmdir /S /Q "%SIDECAR_DIR_ABS%"
if exist "%SIDECAR_DIR_ABS%" (
    echo [ERROR] Failed to remove the previous daemon bundle: %SIDECAR_DIR_ABS%
    exit /b 1
)
mkdir "%SIDECAR_DIR_ABS%"

xcopy /E /Y /I "dist\gemma_daemon" "%SIDECAR_DIR_ABS%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy gemma_daemon bundle.
    exit /b 1
)

if not exist "%SIDECAR_DIR_ABS%\gemma_daemon.exe" (
    echo [ERROR] Copied daemon executable was not found: %SIDECAR_DIR%\gemma_daemon.exe
    exit /b 1
)

echo [Step 5/5] Done.
echo [OUTPUT] %SIDECAR_DIR_ABS%\gemma_daemon.exe
exit /b 0
