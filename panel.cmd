@echo off
chcp 65001 >nul
setlocal
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

rem 用 Edge 的 --app 模式打开：没有地址栏和标签页，看起来就像一个独立的小应用窗口。
if exist "%EDGE%" (
  start "" "%EDGE%" --app=http://127.0.0.1:8787/ --window-size=1280,900
) else (
  start "" http://127.0.0.1:8787/
)
