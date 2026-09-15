-- Métricas de abertura/clique (pedido da reunião de 15/09/2026), via
-- webhook do Resend. resend_email_id guarda o id que o Resend devolve no
-- envio -- é a chave usada pra casar o evento do webhook (data.email_id)
-- de volta com a linha certa em campanhas_envios. aberto_em/clicado_em
-- guardam só a PRIMEIRA ocorrência (métrica é "quantos únicos abriram/
-- clicaram", não quantas vezes).
alter table campanhas_envios add column if not exists resend_email_id text;
alter table campanhas_envios add column if not exists aberto_em timestamptz;
alter table campanhas_envios add column if not exists clicado_em timestamptz;
create index if not exists campanhas_envios_resend_email_id_idx on campanhas_envios (resend_email_id);
