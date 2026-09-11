-- Fase 2 do e-mail dentro do card: dedup das respostas recebidas via
-- Cloudflare Email Routing -> Worker -> webhook (mesmo padrão de
-- incendio_emails_confirmacao). message_id único evita registrar a mesma
-- atividade duas vezes se o Worker reenviar por retry.
create table if not exists public.bitrix_email_respostas_log (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  entity_type_id integer not null,
  item_id integer not null,
  remetente text not null,
  assunto text not null,
  recebido_em timestamptz not null default now(),
  atividade_registrada boolean not null default false,
  erro text
);

alter table public.bitrix_email_respostas_log enable row level security;

-- Utilizada somente pelo webhook de servidor com service role. Nenhuma
-- política pública é criada intencionalmente.
