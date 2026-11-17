@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
ping -n 2 127.0.0.1 >nul 2>&1
