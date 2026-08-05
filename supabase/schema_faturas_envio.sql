-- Suporte ao envio de verdade (Fase 2): liga cada fatura ao registro de
-- envio que a mandou, e guarda a seguradora em faturas_envios pra facilitar
-- relatório/histórico sem precisar voltar em faturas pra descobrir.

alter table faturas add column if not exists envio_id uuid references faturas_envios(id);
alter table faturas_envios add column if not exists seguradora text;
