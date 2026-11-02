@echo off
rem Pos-processamento dos robos do Corp (a cada 6 h, chamado pelo orquestrador; NAO usa o login do Corp).
rem Tudo esta em pos-corp.ts: trava contra duas execucoes, confere memoria livre, telas/OCR/anexos/vinculador/limpeza,
rem leitura dos PDFs novos (apolices, OCR local nos de imagem, propostas), aplicacao no ERP so do que esta vazio e confere,
rem datas/vencimentos/tabelas prontas e relatorio curto (arquivo em saida\ + tabela erp_robo_corp_relatorio).
cd /d "%~dp0..\.."
if not exist scripts\robo-corp\saida mkdir scripts\robo-corp\saida
call npx.cmd tsx scripts/robo-corp/pos-corp.ts %* >> scripts\robo-corp\saida\anexos-pos.log 2>&1
exit /b 0
