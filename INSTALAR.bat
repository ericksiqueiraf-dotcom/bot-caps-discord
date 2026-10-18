@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title INSTALADOR - CAPS ARENA / LCL BOT

echo ============================================================
echo   INSTALADOR - CAPS ARENA / LCL BOT
echo ------------------------------------------------------------
echo   Instala as dependencias, prepara o .env e ORGANIZA o
echo   servidor: cargos, categorias, canais e paineis.
echo   Pode rodar quantas vezes quiser - e idempotente.
echo ============================================================
echo.

REM ================= 0) Node.js + PM2 =================
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo        Instale o Node.js LTS em https://nodejs.org e rode de novo.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
if not exist "instalar.js" (
  echo [ERRO] instalar.js nao encontrado nesta pasta:
  echo        %CD%
  echo        Coloque este INSTALAR.bat na pasta do CAPS BOT.
  echo.
  pause
  exit /b 1
)
set "PM2=%APPDATA%\npm\pm2.cmd"
if not exist "!PM2!" set "PM2=pm2"
echo [OK] Node.js !NODEV!

REM ================= 1) Qual bot =================
:escolher
echo.
echo 1) Qual bot instalar/organizar?
echo      [1] CAPS ARENA
echo      [2] LCL BOT
echo      [3] AMBOS no mesmo servidor  - recomendado p/ servidor novo
echo.
set "ESCOLHA="
set /p "ESCOLHA=   Digite 1, 2 ou 3 e aperte Enter: "
set "ALVO="
if "!ESCOLHA!"=="1" set "ALVO=caps"
if "!ESCOLHA!"=="2" set "ALVO=lcl"
if "!ESCOLHA!"=="3" set "ALVO=ambos"
if not defined ALVO (
  echo    Opcao invalida.
  goto escolher
)

REM ================= 2) GUILD_ID =================
:guild
echo.
set "GUILD="
set /p "GUILD=2) Cole o ID do servidor Discord e aperte Enter: "
set "GUILD=!GUILD: =!"
if "!GUILD!"=="" (
  echo    Informe o ID. No Discord: Configuracoes - Avancado - Modo desenvolvedor,
  echo    depois clique com o botao direito no servidor e em Copiar ID do servidor.
  goto guild
)
node -e "process.exit(/^[0-9]{15,25}$/.test(process.argv[1])?0:1)" "!GUILD!"
if errorlevel 1 (
  echo    ID invalido - use apenas numeros. Ex.: 1273653944169660427
  goto guild
)

echo.
echo ============================================================
echo   Bot escolhido : !ALVO!
echo   Servidor      : !GUILD!
echo ============================================================
echo.

REM ================= 3) Dependencias =================
echo [1/4] Instalando dependencias ...
if not exist "package.json" (
  echo    [ERRO] package.json nao encontrado nesta pasta.
  pause
  exit /b 1
)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo    [ERRO] npm install falhou no CAPS. Confira a internet e tente de novo.
  pause
  exit /b 1
)
echo    [OK] CAPS: dependencias instaladas.

if not "!ALVO!"=="caps" (
  if exist "lcl-bot\package.json" (
    pushd "lcl-bot"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
      echo    [ERRO] npm install falhou no LCL.
      popd
      pause
      exit /b 1
    )
    popd
    echo    [OK] LCL: dependencias instaladas.
  ) else (
    echo    [AVISO] lcl-bot\package.json nao existe - pulando as dependencias do LCL.
  )
)

REM ================= 4) .env =================
echo.
echo [2/4] Conferindo o .env ...
call :garanteToken "." "CAPS ARENA"
if errorlevel 1 goto erro
if not "!ALVO!"=="caps" (
  call :garanteToken "lcl-bot" "LCL BOT"
  if errorlevel 1 goto erro
)

REM ================= 5) Convite + parar o bot =================
echo.
echo [i] Convide o bot no servidor NOVO antes de organizar.
echo     Abra o link, escolha o servidor e marque a caixa Administrador.
echo.
if "!ALVO!"=="lcl" goto convite_lcl
if "!ALVO!"=="ambos" goto convite_ambos
echo     CAPS: https://discord.com/oauth2/authorize?client_id=1487258474810183711^&permissions=8^&scope=bot%%20applications.commands
goto convite_fim

:convite_lcl
echo     LCL : https://discord.com/oauth2/authorize?client_id=1558697998924513441^&permissions=8^&scope=bot%%20applications.commands
goto convite_fim

:convite_ambos
echo     CAPS: https://discord.com/oauth2/authorize?client_id=1487258474810183711^&permissions=8^&scope=bot%%20applications.commands
echo     LCL : https://discord.com/oauth2/authorize?client_id=1558697998924513441^&permissions=8^&scope=bot%%20applications.commands

:convite_fim
echo.
echo     O permissions=8 e o Administrador - e o que permite criar cargos
echo     e canais. Depois do setup voce pode reduzir as permissoes.
echo.
echo     IMPORTANTE: o setup entra no Discord com o MESMO token do bot.
echo     Entao vou PARAR o bot no PM2 durante a organizacao - se ele
echo     estiver aberto, dois logins com o mesmo token brigam entre si.
echo.
pause

echo.
echo [3/4] Parando o bot no PM2, se estiver rodando ...
where pm2 >nul 2>&1
if errorlevel 1 (
  echo    [AVISO] PM2 nao encontrado - nada para parar.
  set "PAROU=N"
  goto organizar
)
if "!ALVO!"=="lcl" goto parar_lcl
if "!ALVO!"=="ambos" goto parar_ambos
call :paraBot "caps-bot"
goto organizar

:parar_lcl
call :paraBot "lcl-bot"
goto organizar

:parar_ambos
call :paraBot "caps-bot"
call :paraBot "lcl-bot"

REM ================= 6) Organizar =================
:organizar
echo.
echo [4/4] Organizando o servidor - cargos, categorias, canais e paineis ...
echo.
node instalar.js !GUILD! !ALVO!
if errorlevel 1 (
  echo.
  echo [ERRO] A organizacao do servidor falhou. Veja a mensagem acima.
  echo        Dica: confirme que o bot foi convidado COM Administrador.
  goto erro
)

REM ================= 7) Subir no PM2 =================
echo.
set "INICIAR="
set /p "INICIAR=Subir o bot agora no PM2? [S/N]: "
if /i not "!INICIAR!"=="S" goto semSubir

where pm2 >nul 2>&1
if errorlevel 1 (
  echo    PM2 nao encontrado. Instalando globalmente ...
  call npm install -g pm2
  if errorlevel 1 (
    echo    [AVISO] Nao consegui instalar o PM2.
    goto semSubir
  )
)

if "!ALVO!"=="lcl" goto pm2_lcl
if "!ALVO!"=="ambos" goto pm2_ambos
call :sobeBot "caps-bot" "."
goto pm2_fim

:pm2_lcl
call :sobeBot "lcl-bot" "lcl-bot"
goto pm2_fim

:pm2_ambos
call :sobeBot "caps-bot" "."
call :sobeBot "lcl-bot" "lcl-bot"

:pm2_fim
call "%PM2%" save >nul 2>&1
echo.
echo Aguardando o login no Discord - 10s ...
ping -n 11 127.0.0.1 >nul
call "%PM2%" list
echo.
echo Teste no servidor: /ping - depois !ajuda no CAPS ou !ajudalcl no LCL.
goto fim

:semSubir
echo.
echo [AVISO] O bot ficou PARADO no PM2.
echo         Para subir depois:
if "!ALVO!"=="caps" echo            pm2 start index.js --name caps-bot
if "!ALVO!"=="lcl" echo            cd lcl-bot ^&^& pm2 start index.js --name lcl-bot
if "!ALVO!"=="ambos" (
  echo            pm2 start index.js --name caps-bot
  echo            cd lcl-bot ^&^& pm2 start index.js --name lcl-bot
)

:fim
echo.
echo ============================================================
echo   PRONTO
echo ------------------------------------------------------------
echo   Servidor organizado: !ALVO! em !GUILD!
echo.
echo   Proximos passos no Discord:
echo     1. De o cargo de Staff para a equipe.
echo     2. No CAPS: !torneioon abre o torneio - o poster sai
echo        sozinho as 10h, 16h e 21h no comunicados e no geral.
echo     3. No LCL: !ajudalcl mostra os comandos.
echo ============================================================
echo.
pause
exit /b 0

REM ================= sub-rotinas =================

:garanteToken
REM %1 = pasta do bot   %2 = nome amigavel
set "DIR=%~1"
set "NOME=%~2"
if not exist "%DIR%" (
  echo    [AVISO] Pasta "%DIR%" nao existe - pulando o !NOME!.
  exit /b 0
)
set "ENVF=%DIR%\.env"
if exist "!ENVF!" (
  findstr /b /c:"DISCORD_TOKEN=" "!ENVF!" >nul 2>&1
  if not errorlevel 1 (
    echo    [OK] !NOME!: DISCORD_TOKEN ja configurado em !ENVF!
    exit /b 0
  )
)
echo.
echo    !NOME!: preciso do token do bot.
echo    Pegue em https://discord.com/developers/applications - sua aplicacao
echo    - Bot - Reset Token / Copy.
set "TOKEN="
set /p "TOKEN=   Cole o DISCORD_TOKEN do !NOME! e aperte Enter: "
if "!TOKEN!"=="" (
  echo    [ERRO] Sem token nao da para continuar.
  exit /b 1
)
set "CDIR=!DIR!"
set "CTOKEN=!TOKEN!"
powershell -NoProfile -Command "$p=Join-Path $env:CDIR '.env'; $l=@(); if (Test-Path $p) { $l = Get-Content $p | Where-Object { $_ -notmatch '^DISCORD_TOKEN=' } }; ($l + ('DISCORD_TOKEN=' + $env:CTOKEN)) | Set-Content -Path $p -Encoding UTF8"
if errorlevel 1 (
  echo    [ERRO] Nao consegui gravar o token em !ENVF!
  exit /b 1
)
echo    [OK] !NOME!: token gravado em !ENVF!
exit /b 0

:paraBot
REM %1 = nome do processo no PM2
call "%PM2%" list 2>nul | findstr /c:"%~1 " >nul
if errorlevel 1 (
  echo    - %~1 nao esta no PM2 - nada para parar.
  exit /b 0
)
call "%PM2%" stop %~1 >nul 2>&1
echo    - %~1 parado.
exit /b 0

:sobeBot
REM %1 = nome do processo   %2 = pasta
pushd "%~2"
call "%PM2%" list 2>nul | findstr /c:"%~1 " >nul
if errorlevel 1 (
  echo    - subindo %~1 ...
  call "%PM2%" start index.js --name %~1
) else (
  echo    - reiniciando %~1 ...
  call "%PM2%" restart %~1 --update-env
)
popd
exit /b 0

:erro
echo.
echo ============================================================
echo   NAO FOI POSSIVEL CONCLUIR
echo   Confira as mensagens acima. Nada foi apagado no servidor.
echo ============================================================
echo.
pause
exit /b 1
