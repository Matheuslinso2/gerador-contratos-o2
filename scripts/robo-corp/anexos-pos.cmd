@echo off
rem Pos-processamento diario dos anexos do Corp (NAO usa o login do Corp; roda em paralelo aos robos, uma vez por dia):
rem   telas -> bucket e OCR local do Windows; envio dos anexos ao Workspace; vinculador; limpeza das fotos ja enviadas.
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
set LOG=scripts\robo-corp\saida\anexos-pos.log
echo ===== %date% %time% ===== >> %LOG%
rem junta o estado de todos os logins em estado.json (os robos so gravam estado-<login>.json)
call npx.cmd tsx scripts/robo-corp/merge-estado.ts >> %LOG% 2>&1
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/enviar-telas.ts >> %LOG% 2>&1
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/ocr-telas.ts >> %LOG% 2>&1
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/ler-telas.ts --gravar >> %LOG% 2>&1
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/enviar-anexos.ts >> %LOG% 2>&1
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/vincular-telas.ts --gravar >> %LOG% 2>&1
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/limpar-telas.ts --gravar >> %LOG% 2>&1
echo fim: %date% %time% >> %LOG%
exit /b 0
