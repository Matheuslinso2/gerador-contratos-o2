-- Metas na própria campanha (22/10/2026) -- substitui os "programas de
-- campanha" (removidos: programa e campanha eram a mesma coisa). Aplicado via
-- MCP (migração campanhas_metas_unificado). Mantido como referência.
alter table public.campanhas add column if not exists campanha_pai_id uuid references public.campanhas(id) on delete set null;
alter table public.campanhas add column if not exists meta_metrica text check (meta_metrica in ('contratacoes', 'cotacoes', 'premio', 'comissao'));
alter table public.campanhas add column if not exists premiacao_descricao text;
alter table public.campanhas add column if not exists custo_premiacao_geral numeric(14,2) not null default 0;
alter table public.campanhas add column if not exists data_apuracao date;
create index if not exists campanhas_pai_idx on public.campanhas (campanha_pai_id);

create table if not exists public.campanhas_metas (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas(id) on delete cascade,
  imobiliaria_id uuid references public.imobiliarias(id) on delete cascade,
  grupo_id uuid references public.imobiliaria_grupos(id) on delete cascade,
  meta numeric(14,2),
  custo_premiacao numeric(14,2) not null default 0,
  observacao text,
  responsavel_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((imobiliaria_id is null) <> (grupo_id is null))
);
create unique index if not exists campanhas_metas_imob_uidx on public.campanhas_metas (campanha_id, imobiliaria_id) where imobiliaria_id is not null;
create unique index if not exists campanhas_metas_grupo_uidx on public.campanhas_metas (campanha_id, grupo_id) where grupo_id is not null;
alter table public.campanhas_metas enable row level security;
create policy "colaborador O2 gerencia metas de campanha" on public.campanhas_metas for all to authenticated
  using ((select public.is_colaborador_o2())) with check ((select public.is_colaborador_o2()));

-- Funil por imobiliária (planilhas + Bitrix) usado pelo quadro de produção.
-- Ver migração campanha_programa_funil_com_card (mesmo nome mantido).
-- create function public.campanha_programa_funil(p_imobs uuid[], p_produtos text[], p_desde date) ...
create index if not exists corp_grade_produtor_proposta_idx on public.corp_grade (codigo_produtor, dt_proposta) where incluir_produtor;
