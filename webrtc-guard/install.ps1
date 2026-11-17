param([switch]$Verify, [switch]$NoOpen)
# WebRTC 泄露防护安装器
# 把扩展复制到固定位置，引导你在 Edge/Chrome 里「加载解压缩的扩展」一次。
# 设置会写进浏览器 profile，之后即使删掉扩展也依然生效。

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'webrtc-guard'
$target = Join-Path $env:LOCALAPPDATA 'WebRTC-Leak-Guard'
$policy = 'disable_non_proxied_udp'

function Get-PrefFiles {
    $candidates = @(
        @{ Browser = 'Edge';   Path = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Secure Preferences' },
        @{ Browser = 'Edge';   Path = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Preferences' },
        @{ Browser = 'Chrome'; Path = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Secure Preferences' },
        @{ Browser = 'Chrome'; Path = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Preferences' }
    )
    $candidates | Where-Object { Test-Path $_.Path }
}

function Test-PolicyApplied {
    $applied = @()
    $pattern = 'webrtc\.ip_handling_policy"?\s*:\s*"' + [regex]::Escape($policy) + '"'
    foreach ($item in Get-PrefFiles) {
        try {
            $raw = Get-Content -Path $item.Path -Raw -Encoding UTF8 -ErrorAction Stop
            if ([regex]::IsMatch($raw, $pattern)) { $applied += $item.Browser }
        } catch {
            # 文件被浏览器占用时跳过
        }
    }
    return ($applied | Select-Object -Unique)
}

if ($Verify) {
    $result = @(Test-PolicyApplied)
    if ($result.Count -gt 0) {
        Write-Host "[OK] WebRTC 防护已生效：$($result -join ', ')" -ForegroundColor Green
        Write-Host "     设置值 = $policy"
        exit 0
    }
    Write-Host "[--] 还没有检测到生效的 WebRTC 防护。" -ForegroundColor Yellow
    Write-Host "     Edge 刚启动时设置可能还没落盘，等几秒再试；或按下面的步骤加载扩展。"
    exit 1
}

# 1. 复制扩展到固定目录（避免以后仓库移动导致扩展失效）
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $source '*') $target -Recurse -Force
Write-Host "[OK] 扩展已复制到：$target" -ForegroundColor Green

# 2. 打开扩展页面和目录
if (-not $NoOpen) {
    Start-Process explorer.exe $target | Out-Null
    $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
    if (Test-Path $edge) {
        Start-Process -FilePath $edge -ArgumentList 'edge://extensions/'
    } else {
        Write-Host "[提示] 没找到 Edge，请手动打开浏览器扩展页。" -ForegroundColor Yellow
    }
    Start-Sleep -Milliseconds 800
}

Write-Host ''
Write-Host '接下来在浏览器扩展页面里做三步：' -ForegroundColor Cyan
Write-Host '  1. 打开「开发人员模式」开关'
Write-Host '  2. 点「加载解压缩的扩展」'
Write-Host "  3. 选择这个目录：$target"
Write-Host ''
Write-Host '装好后扩展会立即把设置写入浏览器（无需重启）。'
Write-Host '验证：双击 check.cmd 打开检测页，或运行 install.cmd -Verify'
