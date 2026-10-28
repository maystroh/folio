@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-folio.ps1" %*
if errorlevel 1 (
  echo.
  echo Installation did not finish. Review the message above.
  pause
)
exit /b %errorlevel%
