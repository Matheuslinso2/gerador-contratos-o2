@echo off
rem Robo do Corp -> Excel -> SharePoint -> Workspace. Agendado no Agendador de
rem Tarefas do Windows ("Robo Corp", todo dia 02:00; ver README.md). Roda a
rem partir da pasta do projeto; registra a saida em saida\ultimo.log.
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
set LOG=scripts\robo-corp\saida\ultimo.log
echo ===== %date% %time% ===== >> %LOG%

rem 1) exporta os 6 Excel do Corp (e copia para a pasta sincronizada do SharePoint, se configurada)
call npx.cmd tsx scripts/robo-corp/exportar.ts %* >> %LOG% 2>&1
if errorlevel 1 (
  echo exportacao falhou: %errorlevel% >> %LOG%
  exit /b 1
)

rem 2) carrega no espelho do Workspace (enquanto o acesso direto ao SharePoint nao esta na Vercel)
call npx.cmd tsx scripts/corp-sharepoint/carregar-local.ts "%USERPROFILE%\.robo-corp\saida" >> %LOG% 2>&1
if errorlevel 1 echo carga no Workspace falhou: %errorlevel% >> %LOG%

rem 3) produtor novo no Corp ganha registro/ficha pela regra do Power BI
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/aplicar-power-bi.ts --gravar >> %LOG% 2>&1

echo fim: %date% %time% >> %LOG%
exit /b 0
