@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-services.ps1"
set "BOS_SERVICES_CHECK_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BOS_SERVICES_CHECK_EXIT%
