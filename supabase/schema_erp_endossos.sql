-- ERP O2 — endossos (Matheus 25/10/2026): todo endosso é filho de uma apólice; tipo do endosso = tipo do Corp
-- (A Apólice · C Endosso de Cobrança · D Devolução de Doc. · F Fatura · I End. Cancel. de Item · M Endosso Sem Prêmio
--  · R Endosso de Restituição · X End. Cancel. de Apólice). Origem do tipo e do motivo = card do funil de endossos
-- de cada SPA (src/lib/erp/bitrixOrigem.ts → tipoEndossoDoRotulo). Aplicado via MCP (migration erp_vincular_endossos).
-- 1ª execução 25/10: 17.671 endossos ligados (X 16.518/17.310 · C 539/582 · M 244/262 · I 224/251 · R 146/146).
create index if not exists erp_documentos_seg_apolice_idx on public.erp_documentos (seguradora_id, numero_apolice) where tipo in ('A', 'F');
-- função public.erp_vincular_endossos(p_limite int default 5000) returns int:
--   liga documento_pai_id (só se vazio) pela seguradora + nº da apólice; com várias apólices de mesmo nº, a que cobre
--   a data do endosso > a mais recente que começou antes > a mais recente. Chamada pelo cron erp-bitrix (lote 2000).
create index if not exists erp_documentos_pai_idx on public.erp_documentos (documento_pai_id) where documento_pai_id is not null; -- ficha da apólice lista os endossos

-- 25/10: card de endosso → apólice pelo campo "Código O2 da apólice" (src/lib/erp/bitrixOrigem.ts → vincularEndossoAoPai).
-- Controle do aviso escrito no card (não repetir comentário). Aplicado via MCP (migration erp_origens_aviso_vinculo).
alter table public.erp_origens add column if not exists aviso_vinculo text, add column if not exists aviso_vinculo_em timestamptz;

-- Estornos de endosso (25/10): erp_extrato_linhas.endosso_documento_id (a linha negativa continua casada com a apólice
-- em documento_id, usada pela baixa); erp_casar_estornos_endosso() casa pelo nº do endosso > prêmio > comissão (317 de
-- 355 na 1ª execução); view erp_estornos_endosso (2 alertas: estorno_sem_endosso, endosso_sem_estorno — este só para
-- seguradora+corretora com extratos COM linhas, emitidos há 30+ dias); tabela pronta erp_estornos_endosso_pronto
-- refeita por erp_atualizar_estornos_endosso() no cron erp-bitrix (1048). Tela: /erp/conferencia, seção "Estornos de endosso".
