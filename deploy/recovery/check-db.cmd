@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-db.ps1"
set "BOS_DB_CHECK_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BOS_DB_CHECK_EXIT%
