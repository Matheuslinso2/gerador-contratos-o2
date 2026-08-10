-- Guarda a comissão da corretora por seguradora e por bairro, pra dar pra
-- calcular ticket médio de comissão nesses dois recortes (hoje só tinha
-- prêmio total, sem comissão).

alter table producao_resumo_seguradora add column if not exists comissao_corretora numeric not null default 0;
alter table producao_resumo_bairro add column if not exists comissao_soma numeric not null default 0;
