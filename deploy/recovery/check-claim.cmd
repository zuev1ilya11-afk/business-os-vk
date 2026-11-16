@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-claim.ps1"
set "BOS_CLAIM_CHECK_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BOS_CLAIM_CHECK_EXIT%
