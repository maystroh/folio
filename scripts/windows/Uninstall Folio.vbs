Option Explicit

Dim fileSystem, shell, baseDir, scriptPath, answer, wmi, processes
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
baseDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fileSystem.BuildPath(baseDir, "uninstall-folio.ps1")

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set processes = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='FolioApp.exe'")
If processes.Count > 0 Then
  MsgBox "Close Folio before uninstalling it.", 48, "Uninstall Folio"
  WScript.Quit 1
End If

answer = MsgBox("Remove Folio from this computer?" & vbCrLf & vbCrLf & "Your saved documents and reading workspaces will not be deleted.", 4 + 32, "Uninstall Folio")
If answer <> 6 Then
  WScript.Quit 0
End If

If Not fileSystem.FileExists(scriptPath) Then
  MsgBox "The uninstall script is missing. Delete the Folio program folder manually.", 16, "Uninstall Folio"
  WScript.Quit 1
End If

shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """ -Force", 0, False
