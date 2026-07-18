@echo off
setlocal
cd /d "%~dp0..\"
powershell -ExecutionPolicy Bypass -NoProfile -File "scripts\android-emulator-smoke.ps1"
echo.
pause
