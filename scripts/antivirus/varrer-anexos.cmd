@echo off
rem Antivirus dos anexos dos formularios publicos (Microsoft Defender).
rem Agendado no Agendador de Tarefas do Windows: "Antivirus Anexos O2", a cada 30 minutos.
rem Log em scripts\antivirus\saida\varredura.log
cd /d "%~dp0..\.."
if not exist scripts\antivirus\saida mkdir scripts\antivirus\saida
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/antivirus/varrer-anexos.ts >> scripts\antivirus\saida\varredura.log 2>&1
