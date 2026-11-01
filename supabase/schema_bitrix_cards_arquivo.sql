-- Foto completa dos cards do Bitrix que chegam já PERDIDOS ou RECUSADOS e por isso não geram documento no ERP (decisão de 28/10).
-- Complementa erp_origens (que guarda a foto dos cards ligados a documento). Assim nenhum card some do funil sem deixar rastro.
-- imobiliaria_id liga ao banco único de imobiliárias. Só o servidor (service role) lê e grava.
create table if not exists public.bitrix_cards_arquivo (
  entity_type_id integer not null,
  item_id bigint not null,
  categoria_id integer,
  etapa text,
  situacao text not null,
  motivo text,
  produto text,
  titulo text,
  url text,
  imobiliaria_id uuid references public.imobiliarias(id),
  locatario_id uuid,
  dados jsonb not null default '{}'::jsonb,
  dados_legiveis jsonb not null default '{}'::jsonb,
  historico_etapas jsonb not null default '[]'::jsonb,
  comentarios jsonb not null default '[]'::jsonb,
  comentarios_capturados_em timestamptz,
  card_criado_em timestamptz,
  card_atualizado_em timestamptz,
  primeira_captura_em timestamptz not null default now(),
  capturado_em timestamptz not null default now(),
  primary key (entity_type_id, item_id)
);
alter table public.bitrix_cards_arquivo enable row level security;
revoke all on public.bitrix_cards_arquivo from anon, authenticated;
create index if not exists bitrix_cards_arquivo_imob_idx on public.bitrix_cards_arquivo (imobiliaria_id);
create index if not exists bitrix_cards_arquivo_titulo_idx on public.bitrix_cards_arquivo (lower(titulo));
