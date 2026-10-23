@echo off
rem Robô de renovações RE: cria no Bitrix os cards de renovação de um mês.
rem uso: criar-cards.cmd AAAA-MM   (ex.: criar-cards.cmd 2026-12)
rem Agendado uma vez pelo Matheus para 26/10/2026 08:00 (tarefa do Windows
rem "Renovacoes RE - cards 12.2026"). Primeiro refaz a prévia (confere de novo
rem se já existe card igual no funil Renovações e a empresa de cada imobiliária);
rem se a prévia falhar, não cria nada. Depois cria os cards (cards.ts --criar),
rem que também cria o campo "Prêmio total anterior" se ele ainda não existir.
rem Saída em renovacoes-re\cards\<mês>\criacao.log.
cd /d "%~dp0..\.."
set MES=%1
if "%MES%"=="" set MES=2026-12
set PASTA=..\renovacoes-re
set LOG=%PASTA%\cards\%MES%\criacao.log
set CORP=%PASTA%\testes-corp-2026-10-22\dez2026 - Simplificado com Produtor.xlsx
set PDF=%PASTA%\testes-corp-2026-10-22\dez2026 - Apresentando Itens e Garantias.pdf
set ITENS=%PASTA%\arquivos-kamila\2026-12_imobiliario_Exporta_itens_pacote.xlsx
echo ===== %date% %time% ===== >> "%LOG%"

call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/cards.ts --mes %MES% --corp "%CORP%" --pdf "%PDF%" --itens "%ITENS%" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo previa falhou: nada foi criado >> "%LOG%"
  exit /b 1
)
if "%2"=="--so-previa" (
  echo so previa: nada foi criado >> "%LOG%"
  exit /b 0
)
call npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/cards.ts --mes %MES% --criar >> "%LOG%" 2>&1
if errorlevel 1 echo criacao falhou ou parou no meio (rodar de novo continua de onde parou) >> "%LOG%"
echo fim: %date% %time% >> "%LOG%"
exit /b 0
