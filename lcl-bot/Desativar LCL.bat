@echo off
setlocal

cd /d "%~dp0"
set "PM2=%APPDATA%\npm\pm2.cmd"
if not exist "%PM2%" set "PM2=pm2"

echo Parando LCL (bot + painel)...
call %PM2% stop lcl-bot >nul 2>&1
call %PM2% stop lcl-admin >nul 2>&1

call %PM2% save >nul 2>&1
call %PM2% list
echo.
echo LCL desativado. CAPS nao foi alterado.
pause
