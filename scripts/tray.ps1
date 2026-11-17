param([switch]$Test)
# V2RayN 流量面板托盘：常驻通知区域，左键打开独立窗口，右键菜单。
# 由登录启动项拉起，无控制台窗口运行。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'data'
$pidFile = Join-Path $dataDir 'tray.pid'
$offMarker = Join-Path $dataDir 'tray.off'
$logFile = Join-Path $dataDir 'tray.log'
$panelUrl = 'http://127.0.0.1:8787/'

function Write-TrayLog([string]$message) {
    try {
        Add-Content -Path $logFile -Value "$(Get-Date -Format o) $message" -Encoding UTF8
    } catch {
        # 日志写不了不影响托盘
    }
}

# ---- 单实例 ----
if (-not $Test -and (Test-Path $pidFile)) {
    $old = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
        Write-Host "Tray already running (pid=$old)"
        exit 0
    }
}
if (-not $Test) {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    Set-Content -Path $pidFile -Value $PID
    if (Test-Path $offMarker) { Remove-Item $offMarker -Force -ErrorAction SilentlyContinue }
    Write-TrayLog "tray started pid=$PID"
}

function New-TrayIcon([System.Drawing.Color]$color) {
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $brush = New-Object System.Drawing.SolidBrush $color
    $g.FillEllipse($brush, 1, 1, 30, 30)
    $font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF 0, 0, 32, 32
    $g.DrawString([string][char]0x00A5, $font, [System.Drawing.Brushes]::White, $rect, $fmt)
    $g.Dispose()
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $brush.Dispose()
    $font.Dispose()
    $bmp.Dispose()
    return $icon
}

$iconOn = New-TrayIcon ([System.Drawing.Color]::FromArgb(91, 140, 255))
$iconOff = New-TrayIcon ([System.Drawing.Color]::FromArgb(90, 100, 120))

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $iconOff
$notify.Text = 'V2RayN 流量面板'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('打开面板（浏览器）')
$miApp = $menu.Items.Add('独立窗口打开')
$miStatus = $menu.Items.Add('状态：读取中…')
$miStatus.Enabled = $false
[void]$menu.Items.Add('-')
$miData = $menu.Items.Add('打开数据目录')
[void]$menu.Items.Add('-')
$miQuit = $menu.Items.Add('退出托盘')

function Format-Bytes([double]$n) {
    if ($n -le 0) { return '0 B' }
    $units = @('B', 'KB', 'MB', 'GB', 'TB')
    $i = 0
    while ($n -ge 1024 -and $i -lt 4) { $n = $n / 1024; $i++ }
    if ($n -ge 100) { return ('{0:N0} {1}' -f $n, $units[$i]) }
    if ($n -ge 10) { return ('{0:N1} {1}' -f $n, $units[$i]) }
    return ('{0:N2} {1}' -f $n, $units[$i])
}

function Update-Status {
    try {
        $o = Invoke-RestMethod -Uri ($panelUrl + 'api/overview') -TimeoutSec 2
        $month = [double]$o.month.up + [double]$o.month.down
        $today = [double]$o.today.up + [double]$o.today.down
        if ($o.status.proxy.captured) { $state = '监控中' }
        elseif ($o.status.relay.running) { $state = '待接管' }
        else { $state = '已停止' }
        $tip = "V2RayN 面板 · $state · 本月 $(Format-Bytes $month)"
        if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
        $notify.Text = $tip
        $notify.Icon = $iconOn
        $miStatus.Text = "本月 $(Format-Bytes $month) · 今日 $(Format-Bytes $today) · $($o.month.conns) 次"
        $miApp.Enabled = $true
        return $true
    } catch {
        $notify.Text = 'V2RayN 面板 · 未运行'
        $notify.Icon = $iconOff
        $miStatus.Text = '面板未运行（V2RayN 没开时会跟着停）'
        $miApp.Enabled = $false
        return $false
    }
}

function Open-AppWindow {
    $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
    # 专用 profile：不加载任何浏览器扩展，面板页面不会被注入悬浮球/拦截脚本
    $profileDir = Join-Path $env:LOCALAPPDATA 'v2rayn-traffic\panel-profile'
    if (Test-Path $edge) {
        Start-Process -FilePath $edge -ArgumentList "--app=$panelUrl --user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check --window-size=1280,900"
    } else {
        Start-Process $panelUrl
    }
}

function Show-OfflineBalloon {
    $notify.ShowBalloonTip(4000, 'V2RayN 流量面板', '面板没在运行。先打开 V2RayN，看护进程会自动把它拉起来。', [System.Windows.Forms.ToolTipIcon]::Info)
}

$miOpen.add_Click({
    if (-not (Update-Status)) { Show-OfflineBalloon; return }
    Start-Process $panelUrl
})

$miApp.add_Click({
    if (-not (Update-Status)) { Show-OfflineBalloon; return }
    Open-AppWindow
})

$miData.add_Click({
    $dir = Join-Path $root 'data'
    if (Test-Path $dir) { Start-Process explorer.exe $dir } else { Start-Process explorer.exe $root }
})

$miQuit.add_Click({
    $notify.Visible = $false
    $notify.Dispose()
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
    # 标记「用户主动退出」，看护进程看到后不会再拉起来
    try { Set-Content -Path $offMarker -Value (Get-Date -Format o) -Encoding UTF8 } catch { }
    Write-TrayLog 'tray quit by user'
    [System.Windows.Forms.Application]::ExitThread()
})

$notify.ContextMenuStrip = $menu
$notify.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        if (-not (Update-Status)) { Show-OfflineBalloon; return }
        Open-AppWindow
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({ [void](Update-Status) })
$timer.Start()

if ($Test) {
    $ok = Update-Status
    Write-Host "TEST ok=$ok"
    Write-Host "TOOLTIP $($notify.Text)"
    Write-Host "STATUS  $($miStatus.Text)"
    $timer.Stop()
    $notify.Visible = $false
    $notify.Dispose()
    exit 0
}

$ctx = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($ctx)
