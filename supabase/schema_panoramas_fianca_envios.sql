-- Envios do Panorama de Preços do Seguro Fiança por e-mail (Fase 2,
-- 16/10/2026). Cada linha = um e-mail enviado de uma versão do panorama.
-- O mesmo envio também vira atividade de e-mail no card do Bitrix.
-- Spec: seguro-fianca-analise/ESPECIFICACAO-ENVIO-EMAIL-PANORAMA-FIANCA.md

create table if not exists public.panoramas_fianca_envios (
  id uuid primary key default gen_random_uuid(),
  panorama_id uuid not null references public.panoramas_fianca (id) on delete cascade,
  card_id integer not null,
  versao integer not null,
  canal text not null default 'email' check (canal in ('email', 'whatsapp')),
  para text[] not null,
  cc text[] not null default '{}',
  assunto text not null,
  enviado_por_email text not null,
  enviado_em timestamptz not null default now(),
  registrado_no_card boolean not null default false,  -- atividade gravada no Bitrix
  resend_id text
);

create index if not exists panoramas_fianca_envios_card_idx on public.panoramas_fianca_envios (card_id, enviado_em desc);

alter table public.panoramas_fianca_envios enable row level security;

drop policy if exists "colaborador_o2_all" on public.panoramas_fianca_envios;
create policy "colaborador_o2_all" on public.panoramas_fianca_envios
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));

-- 16/10/2026: tipos de e-mail além do aprovado (recusado, pendências +
-- recusas) e cartas das seguradoras anexas. Recusa/pendência não tem
-- versão de panorama, por isso panorama_id/versao passam a aceitar vazio.
alter table public.panoramas_fianca_envios alter column panorama_id drop not null;
alter table public.panoramas_fianca_envios alter column versao drop not null;
alter table public.panoramas_fianca_envios add column if not exists tipo text not null default 'aprovado';
alter table public.panoramas_fianca_envios drop constraint if exists panoramas_fianca_envios_tipo_check;
alter table public.panoramas_fianca_envios add constraint panoramas_fianca_envios_tipo_check check (tipo in ('aprovado', 'recusado', 'pendencias'));
alter table public.panoramas_fianca_envios add column if not exists anexos text[] not null default '{}'; -- nomes das cartas anexadas
create index if not exists panoramas_fianca_envios_tipo_idx on public.panoramas_fianca_envios (tipo, card_id);
