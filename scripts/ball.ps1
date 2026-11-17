param([switch]$Test)
# 桌面悬浮球（可配置外观）：
#   尺寸 / 形状 / 透明度 / 配色 / 显示模块 全部来自设置里的 ballAppearance；
#   拖到屏幕边缘会自动吸附成一个小凸起，鼠标移上去展开。
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

# ---------------- 状态 ----------------
$script:state = @{
    down = 0.0; up = 0.0; active = 0
    today = 0.0; month = 0.0
    dailyLimit = 0.0; monthlyLimit = 0.0
    dailyRatio = 0.0
    alertDaily = $false; alertMonthly = $false
    online = $false
}
$script:app = $null          # 当前外观配置
$script:appliedKey = ''      # 外观指纹，变了就重建
$script:edge = $null         # 'left' | 'right' | 'top' | 'bottom' | $null
$script:collapsed = $false
$script:collapseTimer = $null

function Get-AppearanceKey($settings) {
    try {
        return (($settings.ballAppearance | ConvertTo-Json -Depth 6 -Compress) + '|' + $settings.ballOpacity)
    } catch { return '' }
}

function New-RoundPath([int]$w, [int]$h, [int]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $p.AddArc($w - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $p.AddArc($w - $r * 2, $h - $r * 2, $r * 2, $r * 2, 0, 90)
    $p.AddArc(0, $h - $r * 2, $r * 2, $r * 2, 90, 90)
    $p.CloseFigure()
    return $p
}

# ---------------- 窗口 ----------------
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 23, 36)

# 位置记忆
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$posX = $screen.Right - 90
$posY = $screen.Bottom - 150
if (Test-Path $posFile) {
    try {
        $saved = Get-Content $posFile -Raw | ConvertFrom-Json
        if ($null -ne $saved.x) { $posX = [int]$saved.x }
        if ($null -ne $saved.y) { $posY = [int]$saved.y }
    } catch { }
}
$form.Location = New-Object System.Drawing.Point($posX, $posY)

# ---------------- 外观应用 ----------------
function Apply-Appearance($settings) {
    $app = $settings.ballAppearance
    $script:app = $app

    $w = if ($app.shape -eq 'pill') { [int]($app.size * 1.9) } else { [int]$app.size }
    $h = [int]$app.size
    $form.Size = New-Object System.Drawing.Size($w, $h)
    $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml($app.bg)
    $form.Opacity = [double]$settings.ballOpacity

    if ($script:path) { try { $script:path.Dispose() } catch { } }
    if ($form.Region) { try { $form.Region.Dispose() } catch { } }

    if ($app.shape -eq 'pill') {
        $script:path = New-RoundPath $w $h ([int]($h / 2))
        $form.Region = New-Object System.Drawing.Region($script:path)
    } else {
        $script:path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $script:path.AddEllipse(0, 0, $w, $h)
        $form.Region = New-Object System.Drawing.Region($script:path)
    }

    foreach ($m in $app.modules) {
        if ($m.fontObj) { try { $m.fontObj.Dispose() } catch { } }
        $m | Add-Member -NotePropertyName fontObj -NotePropertyValue (New-Object System.Drawing.Font('Segoe UI', [float]$m.font, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)) -Force
    }

    $script:appliedKey = Get-AppearanceKey $settings
    if ($script:edge -and $script:collapsed) { Set-BallPosition }
    $form.Invalidate()
}

function Get-Screen() {
    return [System.Windows.Forms.Screen]::FromControl($form).WorkingArea
}

# 根据吸附状态设置位置
function Set-BallPosition {
    $sc = Get-Screen
    $w = $form.Width
    $h = $form.Height
    $nub = [int]$script:app.nubSize

    if (-not $script:edge) {
        $script:collapsed = $false
        return
    }

    if ($script:collapsed) {
        switch ($script:edge) {
            'right'  { $form.Location = New-Object System.Drawing.Point(($sc.Right - $nub), $form.Top) }
            'left'   { $form.Location = New-Object System.Drawing.Point(($sc.Left - ($w - $nub)), $form.Top) }
            'top'    { $form.Location = New-Object System.Drawing.Point($form.Left, ($sc.Top - ($h - $nub))) }
            'bottom' { $form.Location = New-Object System.Drawing.Point($form.Left, ($sc.Bottom - $nub)) }
        }
    } else {
        switch ($script:edge) {
            'right'  { $form.Location = New-Object System.Drawing.Point(($sc.Right - $w - 2), $form.Top) }
            'left'   { $form.Location = New-Object System.Drawing.Point(($sc.Left + 2), $form.Top) }
            'top'    { $form.Location = New-Object System.Drawing.Point($form.Left, ($sc.Top + 2)) }
            'bottom' { $form.Location = New-Object System.Drawing.Point($form.Left, ($sc.Bottom - $h - 2)) }
        }
    }
}

function Snap-ToEdge {
    if (-not $script:app.edgeSnap) { $script:edge = $null; return }
    $sc = Get-Screen
    $threshold = 16
    $script:edge = $null
    if ([Math]::Abs($form.Right - $sc.Right) -le $threshold) { $script:edge = 'right' }
    elseif ([Math]::Abs($form.Left - $sc.Left) -le $threshold) { $script:edge = 'left' }
    elseif ([Math]::Abs($form.Top - $sc.Top) -le $threshold) { $script:edge = 'top' }
    elseif ([Math]::Abs($form.Bottom - $sc.Bottom) -le $threshold) { $script:edge = 'bottom' }
    if ($script:edge) { $script:collapsed = $true; Set-BallPosition }
}

function Expand-Ball {
    if ($collapseTimer) { $collapseTimer.Stop() }
    if ($script:edge -and $script:collapsed) {
        $script:collapsed = $false
        Set-BallPosition
    }
}

function Collapse-Ball {
    if ($script:edge -and -not $script:collapsed -and -not $menu.Visible) {
        $script:collapsed = $true
        Set-BallPosition
    }
}

# 鼠标离开后延时收起（复用同一个计时器，避免反复创建）
$collapseTimer = New-Object System.Windows.Forms.Timer
$collapseTimer.Interval = 700
$collapseTimer.add_Tick({
    $collapseTimer.Stop()
    Collapse-Ball
})

# ---------------- 绘制 ----------------
function Get-ModuleText([string]$type) {
    switch ($type) {
        'speed.down'    { if (-not $script:state.online) { return '离线' }; return ('↓ ' + (Format-Bytes $script:state.down) + '/s') }
        'speed.up'      { if (-not $script:state.online) { return '' }; return ('↑ ' + (Format-Bytes $script:state.up) + '/s') }
        'usage.today'   { return ('今日 ' + (Format-Bytes $script:state.today)) }
        'usage.month'   { return ('本月 ' + (Format-Bytes $script:state.month)) }
        'limit.percent' {
            if ($script:state.dailyLimit -le 0) { return '' }
            return ('{0:N0}%' -f ($script:state.dailyRatio * 100))
        }
        default { return '' }
    }
}

$form.Add_Paint({
    param($sender, $e)
    if (-not $script:app) { return }
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $w = $sender.ClientSize.Width
    $h = $sender.ClientSize.Height
    $app = $script:app
    $alert = $script:state.alertDaily -or $script:state.alertMonthly

    # 背景
    $bg = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($app.bg))
    $g.FillPath($bg, $script:path)
    $bg.Dispose()

    # 进度：圆形画环，胶囊画底边
    if ($app.ring.enabled -and $script:state.dailyLimit -gt 0) {
        $ratio = $script:state.dailyRatio
        $color = if ($alert) { $app.ring.alert } else { $app.ring.color }
        if ($app.shape -eq 'pill') {
            $barW = [Math]::Max(1, ($w - 10) * $ratio)
            $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($color), 2)
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $g.DrawLine($pen, 5, ($h - 3), (5 + $barW), ($h - 3))
            $pen.Dispose()
        } else {
            $pad = [int]$app.ring.width
            $rect = New-Object System.Drawing.Rectangle($pad, $pad, ($w - $pad * 2 - 1), ($h - $pad * 2 - 1))
            $track = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($app.ring.track), $app.ring.width)
            $g.DrawEllipse($track, $rect)
            $track.Dispose()
            if ($ratio -gt 0) {
                $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($color), $app.ring.width)
                $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
                $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
                $g.DrawArc($pen, $rect, -90, [float](360 * $ratio))
                $pen.Dispose()
            }
        }
    }

    $center = New-Object System.Drawing.StringFormat
    $center.Alignment = [System.Drawing.StringAlignment]::Center
    $center.LineAlignment = [System.Drawing.StringAlignment]::Center
    $center.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap

    foreach ($m in $app.modules) {
        $text = Get-ModuleText $m.type
        if (-not $text) { continue }
        $c = if ($alert -and ($m.type -eq 'speed.down' -or $m.type -eq 'limit.percent')) { $app.ring.alert } else { $m.color }
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($c))
        $lineH = [Math]::Max(10, $m.font * 1.5)
        $rect = New-Object System.Drawing.RectangleF 0, ([float]($m.y * $h - $lineH / 2)), $w, ([float]$lineH)
        $g.DrawString($text, $m.fontObj, $brush, $rect, $center)
        $brush.Dispose()
    }
    $center.Dispose()
})

# ---------------- 交互 ----------------
$script:dragging = $false
$script:dragOffset = $null

$form.Add_MouseDown({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Expand-Ball
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
        $script:edge = $null
        $script:collapsed = $false
    }
})

$form.Add_MouseUp({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left -and $script:dragging) {
        $script:dragging = $false
        Snap-ToEdge
        try {
            @{ x = $sender.Location.X; y = $sender.Location.Y } | ConvertTo-Json | Set-Content -Path $posFile -Encoding UTF8
        } catch { }
    }
})

$form.Add_MouseEnter({
    Expand-Ball
})

$form.Add_MouseLeave({
    if ($collapseTimer) { $collapseTimer.Stop(); $collapseTimer.Start() }
})

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
        Start-Process -FilePath $edge -ArgumentList "--app=$apiBase/settings.html --user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check --window-size=900,760"
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
$miToggle = $menu.Items.Add('收起 / 展开')
[void]$menu.Items.Add('-')
$miHide = $menu.Items.Add('隐藏悬浮球')
$miOpen.add_Click({ Open-Panel })
$miSettings.add_Click({ Open-Settings })
$miToggle.add_Click({ if ($script:edge) { if ($script:collapsed) { Expand-Ball } else { Collapse-Ball } } })
$miHide.add_Click({ Hide-Ball })
$form.ContextMenuStrip = $menu

# ---------------- 数据轮询 ----------------
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
            if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
            [System.Windows.Forms.Application]::Exit()
            return
        }

        $key = Get-AppearanceKey $r.settings
        if ($key -ne $script:appliedKey -and $r.settings.ballAppearance) {
            Apply-Appearance $r.settings
        }
    } catch {
        $script:state.online = $false
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({
    $before = "{0}|{1}|{2}|{3}|{4}" -f [int]$script:state.down, [int]$script:state.today, $script:state.alertDaily, $script:state.online, $script:state.dailyRatio
    Fetch-State
    $after = "{0}|{1}|{2}|{3}|{4}" -f [int]$script:state.down, [int]$script:state.today, $script:state.alertDaily, $script:state.online, $script:state.dailyRatio
    if ($before -ne $after) { $form.Invalidate() }
})

# 首次拉取（同时应用外观），再开始计时
Fetch-State
if (-not $script:app) {
    # 面板还没起来：用一份最小默认外观，保证窗口有形
    $fallback = @{
        ballOpacity = 0.92
        ballAppearance = @{
            size = 66; shape = 'circle'; bg = '#121722'
            ring = @{ enabled = $true; width = 3; track = '#2a3346'; color = '#5b8cff'; alert = '#ff6b6b' }
            modules = @(
                @{ type = 'speed.down'; y = 0.38; font = 11; color = '#3fd6a2' },
                @{ type = 'usage.today'; y = 0.72; font = 8; color = '#9fb0cc' }
            )
        }
    }
    Apply-Appearance ([pscustomobject]$fallback)
}
$timer.Start()

if ($Test) {
    Write-Host ("TEST online={0} size={1}x{2} opacity={3} modules={4}" -f $script:state.online, $form.Width, $form.Height, $form.Opacity, $script:app.modules.Count)
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
    exit 0
}

[System.Windows.Forms.Application]::Run($form)
