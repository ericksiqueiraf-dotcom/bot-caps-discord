@echo off
setlocal

cd /d "%~dp0"
set "PM2=%APPDATA%\npm\pm2.cmd"
if not exist "%PM2%" set "PM2=pm2"

call :garantir lcl-bot "index.js"
call :garantir lcl-admin "admin\app.js"

call %PM2% save >nul 2>&1
call %PM2% list
echo.
echo LCL ativo pelo PM2 (bot + painel). CAPS nao foi alterado.
pause
exit /b 0

:garantir
echo.
echo --- %~1 ---
call %PM2% restart "%~1" --update-env
if errorlevel 1 (
  echo "%~1" nao estava ativo. Iniciando agora...
  call %PM2% start "%~2" --name "%~1"
  if errorlevel 1 (
    echo.
    echo Nao foi possivel ativar "%~1".
    exit /b 1
  )
) else (
  echo "%~1" reiniciado.
)
exit /b 0
