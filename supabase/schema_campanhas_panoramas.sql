-- Panorama da campanha: uma VERSÃO por participante (imobiliária ou grupo) a cada
-- "Enviar parciais" (30/10/2026). Guarda os números exatamente como foram
-- mostrados/enviados, para a imagem do e-mail nunca mudar depois e para o
-- histórico (parciais ao longo do tempo) alimentar a aba do card (Etapa 3).
--
-- status: 'previa' (gerada, ainda não enviada) -> 'enviada' | 'descartada'.
-- token: endereço secreto da imagem (/api/campanhas/panorama/<token>); só mostra
-- os números da própria imobiliária (nenhum dado de comissão/resultado O2).
-- Tabela PRIVADA (RLS ligada, sem política): só o servidor (service role) lê e grava.

create table if not exists public.campanhas_panoramas (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas(id) on delete cascade,
  lote_id uuid not null,
  participante_id text not null,
  imobiliaria_ids uuid[] not null default '{}',
  nome text not null,
  versao int not null default 1,
  status text not null default 'previa' check (status in ('previa', 'enviada', 'descartada')),
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  dados jsonb not null,
  texto text,
  email_campanha_id uuid references public.campanhas(id) on delete set null,
  criado_por text,
  created_at timestamptz not null default now(),
  enviado_em timestamptz
);
create index if not exists campanhas_panoramas_campanha on public.campanhas_panoramas (campanha_id, participante_id, versao);
create index if not exists campanhas_panoramas_lote on public.campanhas_panoramas (lote_id);
alter table public.campanhas_panoramas enable row level security;

-- 03/11/2026: eventos de engajamento da parcial (só depois do envio real; visualização interna e testes não contam).
create table if not exists public.campanhas_panoramas_eventos (
  id uuid primary key default gen_random_uuid(),
  panorama_id uuid not null references public.campanhas_panoramas(id) on delete cascade,
  tipo text not null check (tipo in ('imagem', 'clique_botao')),
  botao int,
  agente text,
  created_at timestamptz not null default now()
);
create index if not exists campanhas_panoramas_eventos_pan on public.campanhas_panoramas_eventos (panorama_id, tipo, created_at);
alter table public.campanhas_panoramas_eventos enable row level security;
