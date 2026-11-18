# 把命令行工具统一指向面板入口 127.0.0.1:10810
# 代理开着时走节点，代理关掉时这个端口自动直连（fail-open），不会断网。
#
# 注意：Windows 环境变量名不区分大小写，HTTP_PROXY 和 http_proxy 是同一个变量。
# 不要同时写大小写两份——PowerShell 的 Start-Process 会报
# "Item has already been added. Key in dictionary"。
$ErrorActionPreference = 'Stop'

$proxy = 'http://127.0.0.1:10810'
$noProxy = 'localhost,127.0.0.1,::1,*.local'

foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) {
    [Environment]::SetEnvironmentVariable($name, $proxy, 'User')
    Write-Host ("[OK] {0}={1}" -f $name, $proxy)
}
[Environment]::SetEnvironmentVariable('NO_PROXY', $noProxy, 'User')
Write-Host ("[OK] NO_PROXY={0}" -f $noProxy)

Write-Host ''
Write-Host '已写入用户环境变量（新开的终端生效，当前终端需重开）。'
Write-Host '提示：'
Write-Host '  - 代理开着：10810 转发到 V2RayN 走节点'
Write-Host '  - 代理关掉：10810 自动直连（fail-open），不会像写死 10808 那样断网'
Write-Host '  - 本地地址已在 NO_PROXY 里，不影响访问本机服务'
