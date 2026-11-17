# Remove the logon autostart entries created by install-startup.ps1.
$startup = [Environment]::GetFolderPath('Startup')
$names = @('V2RayN-Traffic-Watcher.lnk', 'V2RayN-Traffic-Tray.lnk', 'v2rayn-traffic-panel.vbs')

foreach ($name in $names) {
    $path = Join-Path $startup $name
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-Host "[OK] removed: $path"
    }
}

Write-Host "[INFO] Autostart entries cleared."
