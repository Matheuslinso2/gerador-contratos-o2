@echo off
rem Robo dos anexos do Corp (apolices em PDF da aba Anexos). Agendado no Agendador de
rem Tarefas do Windows ("Robo Corp Anexos", todo dia 21:00, depois do Robo Corp das 20:00).
rem Para de pegar documento novo as 06:30 e retoma de onde parou na noite seguinte.
rem So baixa os PDFs (fora do projeto, em %TEMP%\o2-apolices-corp); gravar no Workspace
rem e outra etapa, feita depois da previa (scripts/apolices/carga-drive.ts com APOLICES_FONTE=corp).
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
set LOG=scripts\robo-corp\saida\anexos.log
echo ===== %date% %time% ===== >> %LOG%
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/anexos.ts --ate 06:30 >> %LOG% 2>&1
echo fim: %date% %time% >> %LOG%
exit /b 0
