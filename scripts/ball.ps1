param([switch]$Test)
# 桌面悬浮球：实时速率 + 今日用量 + 今日额度进度环。
# 由看护进程托管，关闭开关后进程退出。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'data'
$pidFile = Join-Path $dataDir 'ball.pid'
$posFile = Join-Path $dataDir 'ball-pos.json'
$logFile = Join-Path $dataDir 'ball.log'
$apiBase = 'http://127.0.0.1:8787'

if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }

function Write-BallLog([string]$message) {
    try { Add-Content -Path $logFile -Value "$(Get-Date -Format o) $message" -Encoding UTF8 } catch { }
}

# ---- 单实例 ----
if (-not $Test -and (Test-Path $pidFile)) {
    $old = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { exit 0 }
}
if (-not $Test) { Set-Content -Path $pidFile -Value $PID; Write-BallLog "ball started pid=$PID" }

function Format-Bytes([double]$n) {
    if ($n -le 0) { return '0 B' }
    $units = @('B', 'KB', 'MB', 'GB', 'TB')
    $i = 0
    while ($n -ge 1024 -and $i -lt 4) { $n = $n / 1024; $i++ }
    if ($n -ge 100) { return ('{0:N0} {1}' -f $n, $units[$i]) }
    if ($n -ge 10) { return ('{0:N1} {1}' -f $n, $units[$i]) }
    return ('{0:N2} {1}' -f $n, $units[$i])
}

# ---- 状态 ----
$script:state = @{
    down = 0.0; up = 0.0; active = 0
    today = 0.0; month = 0.0
    dailyLimit = 0.0; monthlyLimit = 0.0
    dailyRatio = 0.0
    alertDaily = $false; alertMonthly = $false
    online = $false
}

function Fetch-State {
    try {
        $r = Invoke-RestMethod -Uri "$apiBase/api/ball" -TimeoutSec 1
        $script:state.online = $true
        $script:state.down = [double]$r.speed.down
        $script:state.up = [double]$r.speed.up
        $script:state.active = [int]$r.speed.active
        $script:state.today = [double]$r.today.total
        $script:state.month = [double]$r.month.total
        $script:state.dailyLimit = [double]$r.settings.dailyLimit
        $script:state.monthlyLimit = [double]$r.settings.monthlyLimit
        $script:state.dailyRatio = if ($script:state.dailyLimit -gt 0) { [Math]::Min($script:state.today / $script:state.dailyLimit, 1.0) } else { 0 }
        $script:state.alertDaily = [bool]$r.alerts.daily
        $script:state.alertMonthly = [bool]$r.alerts.monthly

        if (-not [bool]$r.settings.ballEnabled) {
            # 设置里关掉了悬浮球：退出，看护不会重启
            if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
            [System.Windows.Forms.Application]::Exit()
            return
        }
    } catch {
        $script:state.online = $false
    }
}

# ---- 窗口 ----
$size = 132
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Size = New-Object System.Drawing.Size($size, $size)
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 23, 36)
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.Opacity = 0.95
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None

# 圆形窗口区域
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddEllipse(0, 0, $size, $size)
$form.Region = New-Object System.Drawing.Region($path)

# 还原上次位置（并夹到当前屏幕内）
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$posX = $screen.Right - $size - 28
$posY = $screen.Bottom - $size - 90
if (Test-Path $posFile) {
    try {
        $saved = Get-Content $posFile -Raw | ConvertFrom-Json
        if ($saved.x -is [int] -or $saved.x -is [double]) { $posX = [int]$saved.x }
        if ($saved.y -is [int] -or $saved.y -is [double]) { $posY = [int]$saved.y }
    } catch { }
}
$posX = [Math]::Max(0, [Math]::Min($posX, $screen.Right - $size))
$posY = [Math]::Max(0, [Math]::Min($posY, $screen.Bottom - $size))
$form.Location = New-Object System.Drawing.Point($posX, $posY)

$script:dragging = $false
$script:dragOffset = $null

$form.Add_MouseDown({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $script:dragging = $true
        $script:dragOffset = $e.Location
    }
})

$form.Add_MouseMove({
    param($sender, $e)
    if ($script:dragging -and $script:dragOffset) {
        $nx = $sender.Location.X + ($e.X - $script:dragOffset.X)
        $ny = $sender.Location.Y + ($e.Y - $script:dragOffset.Y)
        $sender.Location = New-Object System.Drawing.Point($nx, $ny)
    }
})

$form.Add_MouseUp({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left -and $script:dragging) {
        $script:dragging = $false
        try {
            @{ x = $sender.Location.X; y = $sender.Location.Y } | ConvertTo-Json | Set-Content -Path $posFile -Encoding UTF8
        } catch { }
    }
})

# ---- 绘制 ----
$fontDown = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fontUp = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fontSmall = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fontTiny = New-Object System.Drawing.Font('Segoe UI', 8.5, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

function Open-Panel {
    $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
    $profileDir = Join-Path $env:LOCALAPPDATA 'v2rayn-traffic\panel-profile'
    if (Test-Path $edge) {
        Start-Process -FilePath $edge -ArgumentList "--app=$apiBase/ --user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check --window-size=1280,900"
    } else {
        Start-Process "$apiBase/"
    }
}

function Open-Settings {
    $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
    $profileDir = Join-Path $env:LOCALAPPDATA 'v2rayn-traffic\panel-profile'
    if (Test-Path $edge) {
        Start-Process -FilePath $edge -ArgumentList "--app=$apiBase/settings.html --user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check --window-size=900,720"
    } else {
        Start-Process "$apiBase/settings.html"
    }
}

function Hide-Ball {
    try {
        Invoke-RestMethod -Method Post -Uri "$apiBase/api/settings" -ContentType 'application/json' -Body '{"ballEnabled":false}' -TimeoutSec 2 | Out-Null
    } catch { }
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
    [System.Windows.Forms.Application]::Exit()
}

$form.Add_DoubleClick({ Open-Panel })

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('打开面板')
$miSettings = $menu.Items.Add('设置…')
[void]$menu.Items.Add('-')
$miHide = $menu.Items.Add('隐藏悬浮球')
$miOpen.add_Click({ Open-Panel })
$miSettings.add_Click({ Open-Settings })
$miHide.add_Click({ Hide-Ball })
$form.ContextMenuStrip = $menu

$form.Add_Paint({
    param($sender, $e)
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $w = $sender.ClientSize.Width
    $h = $sender.ClientSize.Height

    # 背景圆
    $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 18, 23, 36))
    $g.FillEllipse($bg, 0, 0, $w - 1, $h - 1)
    $bg.Dispose()

    # 进度环
    $pad = 5
    $rect = New-Object System.Drawing.Rectangle($pad, $pad, ($w - $pad * 2 - 1), ($h - $pad * 2 - 1))
    $track = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 42, 51, 70), 4)
    $g.DrawEllipse($track, $rect)
    $track.Dispose()

    if ($script:state.dailyLimit -gt 0 -and $script:state.dailyRatio -gt 0) {
        $ratio = $script:state.dailyRatio
        $ringColor = if ($script:state.alertDaily -or $script:state.alertMonthly) { [System.Drawing.Color]::FromArgb(255, 255, 107, 107) } else { [System.Drawing.Color]::FromArgb(255, 91, 140, 255) }
        $pen = New-Object System.Drawing.Pen($ringColor, 4)
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $g.DrawArc($pen, $rect, -90, [float](360 * $ratio))
        $pen.Dispose()
    }

    # 文字
    $center = New-Object System.Drawing.StringFormat
    $center.Alignment = [System.Drawing.StringAlignment]::Center
    $center.LineAlignment = [System.Drawing.StringAlignment]::Center

    $downColor = if ($script:state.alertDaily -or $script:state.alertMonthly) { [System.Drawing.Color]::FromArgb(255, 255, 150, 150) } else { [System.Drawing.Color]::FromArgb(255, 63, 214, 162) }
    $downBrush = New-Object System.Drawing.SolidBrush($downColor)
    $upBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 143, 92))
    $mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 159, 176, 204))
    $alertBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 107, 107))

    $downText = if ($script:state.online) { '↓ ' + (Format-Bytes $script:state.down) + '/s' } else { '离线' }
    $upText = '↑ ' + (Format-Bytes $script:state.up) + '/s'
    $todayText = '今日 ' + (Format-Bytes $script:state.today)

    $r1 = New-Object System.Drawing.RectangleF 0, 34, $w, 20
    $g.DrawString($downText, $fontDown, $downBrush, $r1, $center)

    if ($script:state.online) {
        $r2 = New-Object System.Drawing.RectangleF 0, 55, $w, 16
        $g.DrawString($upText, $fontUp, $upBrush, $r2, $center)
    }

    $r3 = New-Object System.Drawing.RectangleF 0, 74, $w, 16
    $g.DrawString($todayText, $fontSmall, $mutedBrush, $r3, $center)

    if ($script:state.alertDaily -or $script:state.alertMonthly) {
        $label = if ($script:state.alertDaily) { '今日超限' } else { '本月超限' }
        $r4 = New-Object System.Drawing.RectangleF 0, 92, $w, 14
        $g.DrawString($label, $fontTiny, $alertBrush, $r4, $center)
    } elseif ($script:state.dailyLimit -gt 0) {
        $r4 = New-Object System.Drawing.RectangleF 0, 92, $w, 14
        $pct = '{0:N0}%' -f ($script:state.dailyRatio * 100)
        $g.DrawString($pct, $fontTiny, $mutedBrush, $r4, $center)
    }

    $downBrush.Dispose(); $upBrush.Dispose(); $mutedBrush.Dispose(); $alertBrush.Dispose()
    $center.Dispose()
})

# ---- 定时刷新 ----
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({
    $before = "{0}|{1}|{2}|{3}" -f [int]$script:state.down, $script:state.today, $script:state.alertDaily, $script:state.online
    Fetch-State
    $after = "{0}|{1}|{2}|{3}" -f [int]$script:state.down, $script:state.today, $script:state.alertDaily, $script:state.online
    if ($before -ne $after) { $form.Invalidate() }
})
$timer.Start()

if ($Test) {
    Fetch-State
    Write-Host ("TEST online={0} down={1} today={2} alert={3}" -f $script:state.online, $script:state.down, $script:state.today, $script:state.alertDaily)
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
    exit 0
}

$form.Add_Shown({ $script:state.online = $false; $form.Invalidate() })
[System.Windows.Forms.Application]::Run($form)
