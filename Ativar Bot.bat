@echo off
setlocal

cd /d "%~dp0"
set "PM2=%APPDATA%\npm\pm2.cmd"
if not exist "%PM2%" set "PM2=pm2"

echo ============================================
echo  CAPS Bot - Ativacao
echo ============================================
echo.

REM --- Pre-requisitos ---
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH. Reinstale o Node.js LTS.
  pause
  exit /b 1
)

if not exist "index.js" (
  echo [ERRO] index.js nao encontrado nesta pasta: %CD%
  pause
  exit /b 1
)

if not exist ".env" (
  echo [ERRO] Arquivo .env nao encontrado. Restaure o DISCORD_TOKEN antes de continuar.
  pause
  exit /b 1
)

findstr /b /c:"DISCORD_TOKEN=" ".env" >nul 2>&1
if errorlevel 1 (
  echo [ERRO] DISCORD_TOKEN nao encontrado no .env.
  pause
  exit /b 1
)

REM --- Verifica se o processo ja existe no PM2 ---
REM OBS: "pm2 restart" e "pm2 describe" retornam exit code 0 mesmo quando o
REM processo NAO existe, por isso nao usamos errorlevel do PM2 aqui.
REM Checamos a presenca real do nome exato na lista ("caps-bot " com espaco
REM final para nao confundir com "caps-bot-teste").
call "%PM2%" list 2>nul | findstr /c:"caps-bot " >nul
if errorlevel 1 (
  echo Processo caps-bot nao encontrado no PM2. Iniciando agora...
  call "%PM2%" start index.js --name caps-bot
) else (
  echo Processo caps-bot encontrado. Reiniciando...
  call "%PM2%" restart caps-bot --update-env
)

REM --- Confirma que o processo existe apos a acao (prova real) ---
call "%PM2%" list 2>nul | findstr /c:"caps-bot " >nul
if errorlevel 1 (
  echo.
  echo [ERRO] O PM2 nao criou o processo caps-bot. Ultimas linhas de log:
  call "%PM2%" logs caps-bot --lines 20 --nostream 2>nul
  echo.
  echo Nao foi possivel ativar o CAPS Bot.
  pause
  exit /b 1
)

call "%PM2%" save >nul 2>&1

echo.
echo Processo ativo no PM2. Aguardando login no Discord (10s)...
REM ping como espera de 10s (funciona mesmo sem console; timeout falha com stdin redirecionado)
ping -n 11 127.0.0.1 >nul

REM --- Verifica login real no Discord pelo log ---
call "%PM2%" logs caps-bot --lines 30 --nostream 2>nul | findstr /c:"Bot conectado como" >nul
if errorlevel 1 goto :nologin

echo.
echo [OK] Bot conectado no Discord. Confira no servidor com /ping.
call "%PM2%" list
echo.
echo CAPS Bot ativo pelo PM2.
pause
exit /b 0

:nologin
echo.
echo [AVISO] PM2 online, mas nao confirmei "Bot conectado como" no log.
echo Verifique o token/conexao. Ultimas linhas:
call "%PM2%" logs caps-bot --lines 20 --nostream 2>nul
echo.
echo Teste no Discord com /ping. Se nao responder, confira o .env e rode de novo.
pause
