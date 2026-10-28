Folio 1.0.0 for Windows
=======================

A calm PDF reader and annotation app.

This package deliberately avoids NSIS and Windows Installer, because some
Windows security configurations prevent those installer engines from writing
their temporary files.

INSTALL
-------
1. Extract this entire ZIP to a normal folder (not inside the ZIP preview).
2. Double-click "Install Folio.cmd".
3. Folio will be installed for the current user in:

   %LOCALAPPDATA%\Programs\Folio

The installer creates Desktop and Start Menu shortcuts and registers Folio as
an "Open with" option for .pdf and .folio files. Administrator access is not
required.

If Windows or security software asks whether to allow the script, choose Allow.
The installer only copies the included application files and creates shortcuts.

RUN WITHOUT INSTALLING
----------------------
Open the "app" folder and double-click Folio.vbs, or Folio.cmd.

UNINSTALL
---------
Use the "Uninstall Folio" shortcut in the Start Menu Folio folder, or run
"Uninstall Folio.vbs" in the installed folder. Documents and reading
workspaces are not removed.

FILES
-----
app\FolioApp.exe      The Electron application
app\Folio.vbs         Silent launcher
app\Folio.cmd         Console launcher fallback
app\Folio.ico         Application icon
app\Uninstall Folio.vbs
app\uninstall-folio.ps1

Notes
-----
- The build is unsigned, so Windows SmartScreen may display an unknown
  publisher warning.
- If McAfee or another security product blocks the folder, add the extracted
  Folio folder (and %LOCALAPPDATA%\Programs\Folio after installation) to its
  trusted/excluded locations.
