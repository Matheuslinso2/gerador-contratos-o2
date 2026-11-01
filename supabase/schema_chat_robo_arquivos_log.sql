-- Registro de quem pediu arquivos de documentos (apólices, propostas...) pelo chat do Robô O2. Só o servidor (service role) lê e grava.
create table if not exists public.chat_robo_arquivos_log (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  busca jsonb not null,
  documentos integer not null default 0,
  arquivos jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);
alter table public.chat_robo_arquivos_log enable row level security;
revoke all on public.chat_robo_arquivos_log from anon, authenticated;
create index if not exists chat_robo_arquivos_log_criado_idx on public.chat_robo_arquivos_log (criado_em desc);
