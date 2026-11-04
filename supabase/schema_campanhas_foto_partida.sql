-- Foto de partida CONGELADA de cada participante no lançamento da campanha (03/11/2026):
-- tendência de produção (acumulado de 12 meses e taxa de crescimento em 12 meses), baseline do que
-- produziria sem a campanha, engajamento prévio e grupo de comparação. Base do cálculo de impacto.
-- Tabela PRIVADA (RLS ligada, sem política): só o servidor (service role) lê e grava.
create table if not exists public.campanhas_foto_partida (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas(id) on delete cascade,
  unidade text not null,
  nome text not null,
  imobiliaria_ids uuid[] not null default '{}',
  periodo_inicio date not null,
  periodo_fim date not null,
  meta numeric,
  tendencia text not null,
  dados jsonb not null,
  criado_em timestamptz not null default now(),
  unique (campanha_id, unidade)
);
alter table public.campanhas_foto_partida enable row level security;
