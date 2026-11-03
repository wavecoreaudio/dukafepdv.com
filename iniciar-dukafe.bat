@echo off
REM ============================================================
REM  DUKAFE PDV - inicia o sistema e reinicia sozinho se cair.
REM  Para parar de vez: feche esta janela.
REM ============================================================
title DUKAFE PDV
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org
  pause
  exit /b 1
)

REM Abre o PDV no navegador alguns segundos depois de iniciar
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"

:loop
echo.
echo [%date% %time%] Iniciando DUKAFE PDV...
node server.js
if %errorlevel%==2 (
  echo O sistema ja esta aberto em outra janela. Esta janela sera fechada.
  timeout /t 8 >nul
  exit /b 0
)
echo.
echo [%date% %time%] O servidor parou. Reiniciando em 5 segundos...
echo (para parar de vez, feche esta janela)
timeout /t 5 /nobreak >nul
goto loop
