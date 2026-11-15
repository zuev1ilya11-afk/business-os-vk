@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-login.ps1"
set "BOS_LOGIN_CHECK_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BOS_LOGIN_CHECK_EXIT%
