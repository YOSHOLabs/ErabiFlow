@echo off
setlocal EnableExtensions
cd /d "%~dp0"
pwsh -NoProfile -File "scripts\build_public_lite.ps1"
exit /b %errorlevel%
