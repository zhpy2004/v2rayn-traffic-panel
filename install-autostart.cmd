@echo off
setlocal
cd /d "%~dp0"

echo Creating logon autostart entries (current user, no admin needed)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-startup.ps1"
if errorlevel 1 (
  echo.
  echo [FAILED] Could not create the startup entries.
  pause
  exit /b 1
)

echo.
echo To activate right now without signing out, run: start-watch.cmd
pause
