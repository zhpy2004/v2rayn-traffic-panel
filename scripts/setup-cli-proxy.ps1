# 把命令行工具统一指向面板入口 127.0.0.1:10810
# 代理开着时走节点，代理关掉时这个端口自动直连（fail-open），不会断网。
$ErrorActionPreference = 'Stop'

$proxy = 'http://127.0.0.1:10810'
$noProxy = 'localhost,127.0.0.1,::1,*.local'

foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
    [Environment]::SetEnvironmentVariable($name, $proxy, 'User')
    Write-Host ("[OK] {0}={1}" -f $name, $proxy)
}
foreach ($name in @('NO_PROXY', 'no_proxy')) {
    [Environment]::SetEnvironmentVariable($name, $noProxy, 'User')
    Write-Host ("[OK] {0}={1}" -f $name, $noProxy)
}

Write-Host ''
Write-Host '已写入用户环境变量（新开的终端生效，当前终端需重开）。'
Write-Host '提示：'
Write-Host '  - 代理开着：10810 转发到 V2RayN 走节点'
Write-Host '  - 代理关掉：10810 自动直连（fail-open），不会像写死 10808 那样断网'
Write-Host '  - 本地地址已在 NO_PROXY 里，不影响访问本机服务'
