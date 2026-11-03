@echo off
REM Cria um atalho na pasta "Inicializar" do Windows para o DUKAFE PDV
REM abrir sozinho (minimizado) quando o computador ligar.
cd /d "%~dp0"
set "ALVO=%~dp0iniciar-dukafe.bat"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell;" ^
  "$s = $w.CreateShortcut([Environment]::GetFolderPath('Startup') + '\DUKAFE PDV.lnk');" ^
  "$s.TargetPath = $env:ALVO;" ^
  "$s.WorkingDirectory = (Split-Path $env:ALVO);" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'Inicia o DUKAFE PDV';" ^
  "$s.Save()"
if errorlevel 1 (
  echo [ERRO] Nao foi possivel criar o atalho.
) else (
  echo.
  echo Pronto! O DUKAFE PDV vai iniciar sozinho quando o Windows ligar.
  echo Para desfazer, rode remover-inicio-automatico.bat
  echo.
  echo IMPORTANTE: se mudar a pasta do sistema de lugar, rode este arquivo de novo.
)
echo.
pause
