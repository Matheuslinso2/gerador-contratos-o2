@echo off
rem Bloco de DOCUMENTOS do orquestrador do Corp (24 h): so a parte que usa o login do Corp.
rem   1) fila de documentos (uma vez por dia)   2) visita o Corp e baixa os anexos ate a hora-limite do bloco (%1 = HH:MM)
rem Termina o documento em andamento e libera o login quando o orquestrador cria pausar-docs.flag. Retoma de onde parou.
rem As etapas pesadas que NAO usam o login (OCR das telas, envio, vinculador, limpeza) rodam em anexos-pos.cmd, uma vez por dia.
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
set LOG=scripts\robo-corp\saida\anexos%CORP_LOGIN%.log
set ATE=%1
if "%ATE%"=="" set ATE=06:30
echo ===== %date% %time% (bloco ate %ATE%) ===== >> %LOG%
set MARCA=scripts\robo-corp\saida\fila-%date:~6,4%-%date:~3,2%-%date:~0,2%.ok
rem a fila do dia e montada uma vez, so pelo login principal (CORP_LOGIN vazio); os demais logins so visitam
if "%CORP_LOGIN%"=="" if not exist "%MARCA%" (
  call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/anexos.ts --fila todos >> %LOG% 2>&1
  if not errorlevel 1 echo ok > "%MARCA%"
)
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/anexos.ts --ate %ATE% >> %LOG% 2>&1
set ERRO=%errorlevel%
echo fim do bloco: %date% %time% (codigo %ERRO%) >> %LOG%
rem codigo 3 = login sem permissao (o orquestrador avisa e pausa esse login); os demais erros nao derrubam o orquestrador
if "%ERRO%"=="3" exit /b 3
if "%ERRO%"=="4" exit /b 4
exit /b 0
