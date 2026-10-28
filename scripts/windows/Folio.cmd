@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
if not exist "%~dp0FolioApp.exe" (
  echo FolioApp.exe was not found. Please reinstall Folio.
  pause
  exit /b 1
)

start "" "%~dp0FolioApp.exe" %*
timeout /t 2 /nobreak >nul
tasklist /FI "IMAGENAME eq FolioApp.exe" | find /I "FolioApp.exe" >nul
if errorlevel 1 start "" "%~dp0FolioApp.exe" --no-sandbox --disable-gpu %*
exit /b 0
