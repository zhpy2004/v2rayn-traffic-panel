@echo off
setlocal
cd /d "%~dp0"

echo Removing logon autostart entry...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall-startup.ps1"

echo Stopping the background watcher...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-watcher.ps1"

echo Stopping the tray icon...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-tray.ps1"

echo Stopping the panel (this restores the system proxy)...
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/shutdown' -TimeoutSec 5 | Out-Null; Write-Host 'Panel stopped, proxy restored.' } catch { Write-Host 'Panel was not running.' }"

echo.
echo Done. If browsing still fails, run restore-proxy.cmd.
pause
