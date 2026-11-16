@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-flow.ps1"
set "BOS_FLOW_CHECK_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BOS_FLOW_CHECK_EXIT%
