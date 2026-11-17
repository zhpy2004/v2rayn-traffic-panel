# Restore the Windows system proxy from data/proxy-original.json.
# Standalone: works even when the panel process is not running.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root 'data\proxy-original.json'
$key = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings'

if (-not (Test-Path $file)) {
    Write-Host "No backup found: $file" -ForegroundColor Yellow
    Write-Host "Nothing to restore."
    exit 1
}

$b = Get-Content $file -Raw | ConvertFrom-Json
& reg.exe add $key /v ProxyServer /t REG_SZ /d "$($b.server)" /f | Out-Null
$enableValue = if ($b.enabled) { '1' } else { '0' }
& reg.exe add $key /v ProxyEnable /t REG_DWORD /d $enableValue /f | Out-Null
if ($b.override) {
    & reg.exe add $key /v ProxyOverride /t REG_SZ /d "$($b.override)" /f | Out-Null
}
if ($b.autoConfig) {
    & reg.exe add $key /v AutoConfigURL /t REG_SZ /d "$($b.autoConfig)" /f | Out-Null
}

Add-Type -Namespace WinInet -Name Native -MemberDefinition @'
[DllImport("wininet.dll", SetLastError = true)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
[void][WinInet.Native]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
[void][WinInet.Native]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)

Write-Host "System proxy restored to: $($b.server) (enabled=$($b.enabled))" -ForegroundColor Green
