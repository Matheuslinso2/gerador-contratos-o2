@echo off
rem ERP O2 - arquivos dos cards do Bitrix (SPAs 1042/1046/1048/1050), incremental, de hora em hora: relê os comentarios dos cards alterados
rem desde a ultima varredura, baixa so os arquivos novos (comentarios e campos de arquivo), guarda no bucket bitrix-cards-arquivos e liga ao documento
rem pelo card. SO LEITURA no Bitrix, nao usa o login do Corp. Trava: nao roda por cima da rodada anterior (arquivo arquivos-cards.lock, vale 50 min).
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
set LOG=scripts\robo-corp\saida\arquivos-cards-bitrix.log
set LOCK=%USERPROFILE%\.robo-corp\arquivos-cards.lock
if not exist "%USERPROFILE%\.robo-corp" mkdir "%USERPROFILE%\.robo-corp"
if exist "%LOCK%" (
  powershell -NoProfile -Command "if ((Get-Date) - (Get-Item '%LOCK%').LastWriteTime -lt (New-TimeSpan -Minutes 50)) { exit 1 } else { exit 0 }"
  if errorlevel 1 ( echo %date% %time% rodada anterior ainda em andamento, pulando >> %LOG% & exit /b 0 )
)
echo %date% %time% > "%LOCK%"
echo ===== %date% %time% ===== >> %LOG%
call npx.cmd tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/baixar-arquivos-cards-bitrix.ts --sincronizar >> %LOG% 2>&1
call npx.cmd tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/baixar-campos-arquivo-cards-bitrix.ts >> %LOG% 2>&1
del "%LOCK%" >> %LOG% 2>&1
echo fim: %date% %time% >> %LOG%
exit /b 0
