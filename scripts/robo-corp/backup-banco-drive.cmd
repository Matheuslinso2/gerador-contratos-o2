@echo off
rem ERP O2 - copia de seguranca diaria das tabelas do banco (.ndjson.gz) para a pasta "Backups O2 Supabase" do Google Drive (ou local se o Drive nao estiver instalado).
rem So leitura no banco, com a trava de saude (pausa se o banco estiver pressionado). Rodar de madrugada. Trava: nao roda por cima da rodada anterior (lock vale 6 h).
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
set LOG=scripts\robo-corp\saida\backup-banco-drive.log
set LOCK=%USERPROFILE%\.robo-corp\backup-banco.lock
if not exist "%USERPROFILE%\.robo-corp" mkdir "%USERPROFILE%\.robo-corp"
if exist "%LOCK%" (
  powershell -NoProfile -Command "if ((Get-Date) - (Get-Item '%LOCK%').LastWriteTime -lt (New-TimeSpan -Hours 6)) { exit 1 } else { exit 0 }"
  if errorlevel 1 ( echo %date% %time% rodada anterior ainda em andamento, pulando >> %LOG% & exit /b 0 )
)
echo %date% %time% > "%LOCK%"
echo ===== %date% %time% ===== >> %LOG%
call npx.cmd tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/backup-banco-drive.ts >> %LOG% 2>&1
del "%LOCK%" >> %LOG% 2>&1
echo fim: %date% %time% >> %LOG%
exit /b 0
