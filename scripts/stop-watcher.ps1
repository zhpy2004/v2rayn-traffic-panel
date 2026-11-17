# Stop the background watcher (node ... src/watcher.mjs).
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*watcher.mjs*' -and $_.CommandLine -notlike '*subprocess-local*' }

if (-not $procs) {
    Write-Host "Watcher is not running."
    exit 0
}

foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped watcher pid=$($p.ProcessId)"
}
exit 0
