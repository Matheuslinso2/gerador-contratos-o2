-- Suporte à pergunta de origem: quando uma imobiliária tem 2+ relações
-- ativas com a MESMA seguradora (ex: Tokio via O2 Seguros e via SegImob),
-- o upload sozinho não tem como saber qual das duas aquele arquivo é --
-- precisa perguntar na Conferência. `origem` guarda a resposta; o status
-- novo marca quem está esperando essa resposta.

alter table faturas add column if not exists origem text;

alter table faturas drop constraint if exists faturas_status_check;
alter table faturas add constraint faturas_status_check check (status in (
  'aguardando_upload', 'fatura_carregada', 'aguardando_identificacao',
  'aguardando_conferencia', 'aguardando_origem', 'pronta_para_envio', 'enviada',
  'erro_no_envio', 'duplicada', 'cancelada'
));
