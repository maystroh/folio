Option Explicit

Dim fileSystem, shell, baseDir, appPath, arguments, wmi, processes, i
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
On Error Resume Next
shell.Environment("PROCESS").Remove("ELECTRON_RUN_AS_NODE")
Err.Clear
On Error GoTo 0
baseDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
appPath = fileSystem.BuildPath(baseDir, "FolioApp.exe")
shell.CurrentDirectory = baseDir

arguments = ""
For i = 0 To WScript.Arguments.Count - 1
  arguments = arguments & " " & Quote(WScript.Arguments(i))
Next

If Not fileSystem.FileExists(appPath) Then
  MsgBox "FolioApp.exe was not found. Please reinstall Folio.", 16, "Folio"
  WScript.Quit 1
End If

' First try the normal Chromium sandbox. Some locked-down Windows profiles
' cannot initialize it, so retry with software rendering and the sandbox switch.
shell.Run """" & appPath & """" & arguments, 1, False
WScript.Sleep 1800

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set processes = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='FolioApp.exe'")
If processes.Count = 0 Then
  shell.Run """" & appPath & """ --no-sandbox --disable-gpu" & arguments, 1, False
End If

Function Quote(value)
  Quote = """" & Replace(value, """", """""") & """"
End Function
