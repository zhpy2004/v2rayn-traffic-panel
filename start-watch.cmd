@echo off
setlocal
cd /d "%~dp0"

rem Start the background watcher and the tray icon now (no need to sign out).
rem explorer.exe launches them outside this console's process tree, so closing
rem the window (or the parent session) does not take them down.
start "" explorer.exe "%~dp0scripts\watcher-hidden.vbs"
start "" explorer.exe "%~dp0scripts\tray-hidden.vbs"

echo Started in the background:
echo   - watcher: starts the panel + captures the proxy when V2RayN starts
echo   - tray: notification area icon, left click opens the panel window
echo   - logs: %~dp0data\watcher.log, %~dp0data\tray.log
ping -n 4 127.0.0.1 >nul 2>&1
