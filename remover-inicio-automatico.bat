@echo off
REM Remove o inicio automatico do DUKAFE PDV
set "ATALHO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DUKAFE PDV.lnk"
if exist "%ATALHO%" (
  del "%ATALHO%"
  echo Inicio automatico removido.
) else (
  echo O inicio automatico nao estava ativado.
)
echo.
pause
