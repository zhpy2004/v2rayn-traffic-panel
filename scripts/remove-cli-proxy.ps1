# 撤销 setup-cli-proxy.ps1 设置的环境变量
$vars = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy')
foreach ($name in $vars) {
    [Environment]::SetEnvironmentVariable($name, $null, 'User')
    Write-Host "[OK] removed $name"
}
Write-Host 'Done. Reopen your terminal for it to take effect.'
