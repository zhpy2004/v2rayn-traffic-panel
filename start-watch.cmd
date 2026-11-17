@echo off
setlocal
cd /d "%~dp0"

rem Start the background watcher and the tray icon now (no need to sign out).
rem Closing this window does not stop them.
start "" wscript.exe "%~dp0scripts\watcher-hidden.vbs"
start "" wscript.exe "%~dp0scripts\tray-hidden.vbs"

echo Started in the background:
echo   - watcher: starts the panel + captures the proxy when V2RayN starts
echo   - tray: notification area icon, left click opens the panel window
echo   - log: %~dp0data\watcher.log
ping -n 4 127.0.0.1 >nul 2>&1
