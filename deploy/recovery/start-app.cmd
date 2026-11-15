@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app.ps1"
set "BOS_APP_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BOS_APP_EXIT%
