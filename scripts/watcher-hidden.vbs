' 隐藏窗口启动看护进程（登录任务用）
' 用法: wscript.exe watcher-hidden.vbs
Option Explicit
Dim shell, fso, here, node, script
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.GetParentFolderName(here) & "\src\watcher.mjs"
node = "node.exe"
shell.CurrentDirectory = fso.GetParentFolderName(here)
shell.Run """" & node & """ --disable-warning=ExperimentalWarning """ & script & """", 0, False
