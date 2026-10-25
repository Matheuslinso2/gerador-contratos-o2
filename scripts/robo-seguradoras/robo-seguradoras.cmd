@echo off
rem Robo de baixa: baixa os extratos de comissao dos portais das seguradoras e grava no ERP (/erp/baixas).
rem Agendado no Agendador de Tarefas do Windows ("Robo Seguradoras", todo dia 20:30 — Matheus 25/10: so depois das 20h).
rem Nao escreve nada no Corp nem nos portais. Log em scripts\robo-seguradoras\saida\ultimo.log.
cd /d "%~dp0..\.."
if not exist scripts\robo-seguradoras\saida mkdir scripts\robo-seguradoras\saida
set LOG=scripts\robo-seguradoras\saida\ultimo.log
echo ===== %date% %time% ===== >> %LOG%

rem 1) Tokio Marine (codigos 55002, 195354 e 70145; ultimos 15 dias)
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-seguradoras/tokio.ts %* >> %LOG% 2>&1
if errorlevel 1 echo Tokio falhou: %errorlevel% >> %LOG%

rem 2) Porto Seguro (favorecidas LI7PMJ e G0852J; mes atual e anterior; so pagamentos ainda nao gravados)
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-seguradoras/porto.ts >> %LOG% 2>&1
if errorlevel 1 echo Porto falhou: %errorlevel% >> %LOG%
