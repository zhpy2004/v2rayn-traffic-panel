@echo off
setlocal
cd /d "%~dp0"
title V2RayN Traffic Panel

rem Auto-capture system proxy on start (restored when the panel exits).
rem Default is 0: open the panel first, then click "Capture" there.
rem Change to 1 if you want it captured immediately.
set TRAFFIC_AUTO_CAPTURE=0
set TRAFFIC_OPEN=1

node --disable-warning=ExperimentalWarning src\server.js

echo.
echo Panel exited. If you cannot browse now, run restore-proxy.cmd.
pause
