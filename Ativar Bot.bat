@echo off
setlocal

cd /d "%~dp0"
set "PM2=%APPDATA%\npm\pm2.cmd"
if not exist "%PM2%" set "PM2=pm2"

echo Tentando reiniciar o CAPS Bot...
call %PM2% restart caps-bot --update-env
if errorlevel 0 goto :ok

echo Bot nao estava ativo. Iniciando agora...
call %PM2% start index.js --name caps-bot
if errorlevel 1 (
  echo.
  echo Nao foi possivel ativar o CAPS Bot.
  pause
  exit /b 1
)

:ok
call %PM2% save >nul 2>&1
call %PM2% list
echo.
echo CAPS Bot ativo pelo PM2.
pause
