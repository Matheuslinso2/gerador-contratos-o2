@echo off
rem Robo dos anexos do Corp: baixa TODOS os arquivos da aba Anexos de cada documento e
rem envia ao Workspace (bucket corp-anexos + tabela corp_anexos, aba Anexos do ERP).
rem Agendado no Agendador de Tarefas do Windows:
rem   "Robo Corp Anexos"           todo dia 21:00, ate 06:30
rem   "Robo Corp Anexos FDS manha" sabado e domingo 06:40, ate 11:45 (livra o Robo Corp das 12:00)
rem   "Robo Corp Anexos FDS tarde" sabado e domingo 12:30, ate 19:45 (livra o Robo Corp das 20:00)
rem Uso: anexos-noite.cmd [HH:MM de parada, padrao 06:30]. Retoma de onde parou.
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
set LOG=scripts\robo-corp\saida\anexos.log
set ATE=%1
if "%ATE%"=="" set ATE=06:30
echo ===== %date% %time% (ate %ATE%) ===== >> %LOG%

rem 1) fila com todos os documentos do Corp (vigentes primeiro; pega os novos)
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/anexos.ts --fila todos >> %LOG% 2>&1

rem 2) visita o Corp e baixa os anexos
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/anexos.ts --ate %ATE% >> %LOG% 2>&1

rem 3) envia ao Workspace o que foi baixado (e apaga da pasta local o que nao e apolice)
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/enviar-anexos.ts >> %LOG% 2>&1

echo fim: %date% %time% >> %LOG%
exit /b 0
