@echo off
rem Robo do Corp -> Excel -> SharePoint. Agendado no Agendador de Tarefas do Windows
rem (ver README.md). Roda a partir da pasta do projeto; registra a saida em saida\ultimo.log.
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
echo ===== %date% %time% ===== >> scripts\robo-corp\saida\ultimo.log
call npx.cmd --yes tsx scripts/robo-corp/exportar.ts %* >> scripts\robo-corp\saida\ultimo.log 2>&1
echo saida: %errorlevel% >> scripts\robo-corp\saida\ultimo.log
exit /b %errorlevel%
