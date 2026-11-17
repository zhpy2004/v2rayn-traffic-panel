@echo off
setlocal
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

rem 用 Edge 的 --app 模式打开：没有地址栏和标签页，看起来像一个独立小应用。
rem 关键：使用专用 profile（--user-data-dir），该 profile 不装任何扩展，
rem 避免沉浸式翻译/AdGuard 等扩展往面板页面里注入悬浮球、改 DOM、拦请求。
set "PROFILE=%LOCALAPPDATA%\v2rayn-traffic\panel-profile"

if exist "%EDGE%" (
  start "" "%EDGE%" --app=http://127.0.0.1:8787/ --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --window-size=1280,900
) else (
  start "" http://127.0.0.1:8787/
)
