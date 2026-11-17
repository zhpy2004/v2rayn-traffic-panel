# Stop the tray icon process.
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'data\tray.pid'
$self = $PID
$stopped = 0

if (Test-Path $pidFile) {
    $trayPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($trayPid -and [int]$trayPid -ne $self) {
        $proc = Get-Process -Id $trayPid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $proc.Id -Force
            Write-Host "Stopped tray pid=$trayPid"
            $stopped++
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if ($stopped -eq 0) {
    # 只匹配 ...\scripts\tray.ps1，避免误伤 stop-tray.ps1 自己和外部进程
    $others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object {
            $_.ProcessId -ne $self -and
            $_.CommandLine -match '[\\/]scripts[\\/]tray\.ps1' -and
            $_.CommandLine -notmatch 'subprocess-local'
        }
    foreach ($p in $others) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped tray pid=$($p.ProcessId)"
        $stopped++
    }
}

if ($stopped -eq 0) { Write-Host "Tray is not running." }
exit 0
