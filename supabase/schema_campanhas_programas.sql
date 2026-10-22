-- Programas de campanha com metas (22/10/2026). Aplicado via MCP em
-- produção (migrações campanhas_programas_metas, campanha_programa_funil_rapida
-- e corp_grade_produtor_proposta_idx). Guardado aqui só como referência.

create table if not exists public.campanhas_programas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  objetivo text,
  produtos text[] not null default '{}',
  metrica text not null default 'contratacoes' check (metrica in ('contratacoes', 'cotacoes', 'premio', 'comissao')),
  inicio date not null,
  fim date not null,
  data_apuracao date,
  premiacao_descricao text,
  custo_premiacao_geral numeric(14,2) not null default 0,
  status text not null default 'ativa' check (status in ('planejada', 'ativa', 'encerrada', 'apurada')),
  responsavel_email text,
  criado_por_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  arquivado_em timestamptz,
  check (fim >= inicio)
);

create table if not exists public.campanhas_programas_participantes (
  id uuid primary key default gen_random_uuid(),
  programa_id uuid not null references public.campanhas_programas(id) on delete cascade,
  imobiliaria_id uuid references public.imobiliarias(id) on delete cascade,
  grupo_id uuid references public.imobiliaria_grupos(id) on delete cascade,
  meta numeric(14,2),
  observacao text,
  custo_premiacao numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((imobiliaria_id is null) <> (grupo_id is null))
);
create unique index if not exists campanhas_programas_part_imob_uidx on public.campanhas_programas_participantes (programa_id, imobiliaria_id) where imobiliaria_id is not null;
create unique index if not exists campanhas_programas_part_grupo_uidx on public.campanhas_programas_participantes (programa_id, grupo_id) where grupo_id is not null;
create index if not exists campanhas_programas_part_programa_idx on public.campanhas_programas_participantes (programa_id);

alter table public.campanhas add column if not exists programa_id uuid references public.campanhas_programas(id) on delete set null;
create index if not exists campanhas_programa_idx on public.campanhas (programa_id);

alter table public.campanhas_programas enable row level security;
alter table public.campanhas_programas_participantes enable row level security;
create policy "colaborador O2 gerencia programas" on public.campanhas_programas for all to authenticated
  using ((select public.is_colaborador_o2())) with check ((select public.is_colaborador_o2()));
create policy "colaborador O2 gerencia participantes" on public.campanhas_programas_participantes for all to authenticated
  using ((select public.is_colaborador_o2())) with check ((select public.is_colaborador_o2()));

-- Funil (planilhas + Bitrix) só das imobiliárias pedidas, com a mesma regra de
-- resolução de imobiliária da view producao_resolvida.
create or replace function public.campanha_programa_funil(p_imobs uuid[], p_produtos text[], p_desde date)
returns table (
  id uuid, chave_caso text, imobiliaria_id uuid, produto text, status_padrao text,
  data_recebimento date, data_efetivacao date, premio numeric, comissao numeric, herdada boolean
)
language sql stable
set search_path = public
as $$
  with chaves as (
    select distinct r.fonte, k.texto
    from imobiliaria_registros_fonte r
    cross join lateral (values (r.chave_externa), (r.nome_original)) as k(texto)
    where r.imobiliaria_id = any (p_imobs) and r.situacao = 'confirmado' and k.texto is not null
  )
  select p.id, p.chave_caso, v.imobiliaria_id, p.produto, p.status_padrao,
         p.data_recebimento, p.data_efetivacao, p.premio, p.comissao, p.herdada
  from chaves c
  join producao_unificada p on p.fonte_vinculo = c.fonte and p.imobiliaria_texto = c.texto
  cross join lateral (
    select r.imobiliaria_id
    from imobiliaria_registros_fonte r
    where r.fonte = p.fonte_vinculo and r.situacao = 'confirmado'
      and (r.chave_externa = p.imobiliaria_texto or r.nome_original = p.imobiliaria_texto)
    order by (r.chave_externa = p.imobiliaria_texto) desc
    limit 1
  ) v
  where p.fonte in ('planilha', 'bitrix')
    and p.produto = any (p_produtos)
    and (p.data_recebimento >= p_desde or p.data_efetivacao >= p_desde)
    and not coalesce(p.imobiliaria_texto ~* '^O2 CORRETORA', false)
    and v.imobiliaria_id = any (p_imobs);
$$;
revoke all on function public.campanha_programa_funil(uuid[], text[], date) from public, anon;
grant execute on function public.campanha_programa_funil(uuid[], text[], date) to authenticated, service_role;

create index if not exists corp_grade_produtor_proposta_idx on public.corp_grade (codigo_produtor, dt_proposta) where incluir_produtor;
