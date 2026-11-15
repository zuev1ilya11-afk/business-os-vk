@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-app.ps1"
set "BOS_CHECK_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BOS_CHECK_EXIT%
