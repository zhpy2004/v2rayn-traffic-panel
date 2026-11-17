' 隐藏窗口启动托盘（登录启动项 / start-watch.cmd 用）
Option Explicit
Dim shell, fso, here, script
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.GetParentFolderName(here) & "\scripts\tray.ps1"
shell.CurrentDirectory = fso.GetParentFolderName(here)
shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & script & """", 0, False
