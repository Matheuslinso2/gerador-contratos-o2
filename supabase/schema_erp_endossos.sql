-- ERP O2 — endossos (Matheus 25/10/2026): todo endosso é filho de uma apólice; tipo do endosso = tipo do Corp
-- (A Apólice · C Endosso de Cobrança · D Devolução de Doc. · F Fatura · I End. Cancel. de Item · M Endosso Sem Prêmio
--  · R Endosso de Restituição · X End. Cancel. de Apólice). Origem do tipo e do motivo = card do funil de endossos
-- de cada SPA (src/lib/erp/bitrixOrigem.ts → tipoEndossoDoRotulo). Aplicado via MCP (migration erp_vincular_endossos).
-- 1ª execução 25/10: 17.671 endossos ligados (X 16.518/17.310 · C 539/582 · M 244/262 · I 224/251 · R 146/146).
create index if not exists erp_documentos_seg_apolice_idx on public.erp_documentos (seguradora_id, numero_apolice) where tipo in ('A', 'F');
-- função public.erp_vincular_endossos(p_limite int default 5000) returns int:
--   liga documento_pai_id (só se vazio) pela seguradora + nº da apólice; com várias apólices de mesmo nº, a que cobre
--   a data do endosso > a mais recente que começou antes > a mais recente. Chamada pelo cron erp-bitrix (lote 2000).
