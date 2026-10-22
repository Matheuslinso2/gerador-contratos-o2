-- Contatos com a imobiliária feitos FORA do Bitrix (22/10/2026): telefone ou
-- WhatsApp particular do vendedor, visita, etc. Pertence à ficha da
-- imobiliária (banco único), não à campanha -- campanha_id só registra de
-- onde foi lançado. O quadro "Último contato" da campanha junta isto com as
-- atividades do Bitrix. Aplicado via MCP (migração imobiliaria_contatos).
create table if not exists public.imobiliaria_contatos (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,
  campanha_id uuid references public.campanhas(id) on delete set null,
  canal text not null check (canal in ('ligacao', 'whatsapp', 'email', 'reuniao', 'visita', 'outro')),
  data_contato date not null,
  feito_por_email text not null,
  observacao text,
  registrado_por_email text not null,
  created_at timestamptz not null default now()
);
create index if not exists imobiliaria_contatos_imob_data_idx on public.imobiliaria_contatos (imobiliaria_id, data_contato desc);
create index if not exists imobiliaria_contatos_campanha_idx on public.imobiliaria_contatos (campanha_id);
alter table public.imobiliaria_contatos enable row level security;
create policy "colaborador O2 gerencia contatos com imobiliarias" on public.imobiliaria_contatos for all to authenticated
  using ((select public.is_colaborador_o2())) with check ((select public.is_colaborador_o2()));
