# Install logon autostart entries (current user, no admin needed).
# Two shortcuts in the Startup folder: watcher (follows V2RayN) and tray icon.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$scripts = Join-Path $root 'scripts'
$startup = [Environment]::GetFolderPath('Startup')
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

$wsh = New-Object -ComObject WScript.Shell

$entries = @(
    @{ Name = 'V2RayN-Traffic-Watcher.lnk'; Vbs = Join-Path $scripts 'watcher-hidden.vbs'; Desc = 'V2RayN traffic panel watcher' },
    @{ Name = 'V2RayN-Traffic-Tray.lnk'; Vbs = Join-Path $scripts 'tray-hidden.vbs'; Desc = 'V2RayN traffic panel tray icon' }
)

foreach ($e in $entries) {
    $path = Join-Path $startup $e.Name
    $sc = $wsh.CreateShortcut($path)
    $sc.TargetPath = $wscript
    $sc.Arguments = "`"$($e.Vbs)`""
    $sc.WorkingDirectory = $root
    $sc.Description = $e.Desc
    $sc.Save()
    Write-Host "[OK] $path"
}

# 清理旧版本生成的单个 vbs
$legacy = Join-Path $startup 'v2rayn-traffic-panel.vbs'
if (Test-Path $legacy) {
    Remove-Item $legacy -Force
    Write-Host "[OK] removed legacy entry: $legacy"
}

Write-Host ''
Write-Host 'Autostart installed. Activate now without signing out: run start-watch.cmd'
