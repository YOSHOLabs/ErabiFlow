@echo off
chcp 65001 > nul
pushd "%~dp0"
echo =========================================
echo ErabiFlow Dev Mode
echo =========================================
echo.
echo * Hot-reloading is enabled.
echo * Close this window to exit.
echo.

call npx tauri dev
set "TAURI_EXIT_CODE=%ERRORLEVEL%"

if not "%TAURI_EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] ErabiFlow failed to start. Exit code: %TAURI_EXIT_CODE%
)
pause
popd
exit /b %TAURI_EXIT_CODE%
