@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore.ps1" -BundlePath "%USERPROFILE%\BOS-Backup"
set "BOS_RESTORE_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BOS_RESTORE_EXIT%
