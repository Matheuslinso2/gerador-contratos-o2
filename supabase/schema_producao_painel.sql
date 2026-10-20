-- Base Única — Fase 5: novo painel /producao (2026-10-19).
-- Resumo por mês × produto × seguradora × imobiliária/grupo, montado a partir
-- de producao_unificada (via producao_resolvida, que resolve a imobiliária só
-- por vínculo CONFIRMADO). Duas origens:
--   'producao' = Corp (o que foi efetivado: propostas, prêmio, comissão);
--   'funil'    = cotações/análises — planilhas (até jul/2026) e SPA do Bitrix
--                (ago/2026 →), com os MESMOS KPIs (Matheus 20/10: "quando a
--                fonte muda, só a fonte muda"). Cada cotação gera eventos:
--                entrada (mês em que entrou, com a etapa atual = a mais
--                avançada) e aprovação/recusa/perda/conversão no mês em que
--                aconteceram — mesma regra do painel /seguro-fianca.
-- Automóvel não tem vínculo com imobiliária (decisão de 16/10): entra só no macro.
-- Sem RLS (materialized view): fechada para anon/authenticated; leitura só pela
-- função kpis_producao(), que confere is_colaborador_o2().

-- 2026-10-19 (Fase 3): índices usados na regravação das importações.
create index if not exists producao_unificada_importacao_idx on producao_unificada (importacao_id);
create index if not exists producao_unificada_locatario_idx on producao_unificada (locatario_id);

create or replace function producao_seguradora_curta(s text) returns text
language sql immutable as $$
  select case
    when s is null or btrim(s) = '' then null
    when upper(s) ~ 'TOKIO' then 'Tokio Marine'
    when upper(s) ~ 'PORTO|ESSENCIAL' then 'Porto'
    when upper(s) ~ 'POTT' then 'Pottencial'
    when upper(s) ~ 'YELUM|LIBERTY' then 'Yelum (ex-Liberty)'
    when upper(s) ~ 'BRASILCAP' then 'Brasilcap'
    when upper(s) ~ 'ICATU' then 'Icatu'
    when upper(s) ~ 'SUL ?AMERICA' then 'SulAmérica'
    when upper(s) ~ 'BRADESCO' then 'Bradesco'
    when upper(s) ~ '^ALFA' then 'Alfa'
    when upper(s) ~ '^TOO' then 'Too'
    when upper(s) ~ 'ALLIANZ' then 'Allianz'
    when upper(s) ~ 'CARDIF' then 'Cardif'
    when upper(s) ~ 'MAPFRE' then 'Mapfre'
    when upper(s) ~ 'ZURICH' then 'Zurich'
    when upper(s) ~ 'SUHAI' then 'Suhai'
    when upper(s) ~ 'AZUL' then 'Azul'
    when upper(s) ~ 'HDI' then 'HDI'
    when upper(s) ~ 'SOMPO|YASUDA' then 'Sompo'
    when upper(s) ~ '^(APROVADO|CONVERTIDO|PRAZO|MIGRACAO.*|\d+|[A-Z]{3} [A-Z]{3} \d.*)$' then null -- lixo de digitação da planilha
    else 'Outras'
  end
$$;

drop materialized view if exists producao_painel_mensal;
create materialized view producao_painel_mensal as
with corp as (
  select 'producao'::text as origem,
         p.competencia_arquivo as competencia,
         p.produto,
         p.ramo_padrao as ramo,
         producao_seguradora_curta(p.seguradora) as seguradora,
         p.susep_o2 as susep,
         case
           when p.produto = 'automovel' then 'automovel'
           when p.canal = 'venda_direta_o2' then 'venda_direta'
           when p.imobiliaria_id is not null then 'imobiliaria'
           when p.extras ? 'sem_imobiliaria_so_canal' then 'so_canal'
           else 'nao_identificado'
         end as canal,
         case when p.produto = 'automovel' then null else p.imobiliaria_id end as imobiliaria_id,
         case when p.produto = 'automovel' then null else p.grupo_id end as grupo_id,
         null::text as etapa,
         null::text as evento,
         p.premio, p.comissao
  from producao_resolvida p
  where p.fonte = 'corp'
    and p.competencia_arquivo between '2015-01' and to_char(now(), 'YYYY-MM')
    and not coalesce(p.extras ? 'data_proposta_suspeita', false)
),
-- Planilhas: a mesma análise aparece no mês em que entrou e, se ainda estava
-- em andamento no fim do mês, de novo no mês seguinte (herança). O mês de
-- cada evento é o da primeira planilha em que a análise aparece naquela situação.
plan_linhas as (
  select p.*,
         case p.status_padrao when 'Convertido' then 6 when 'Perdido' then 5 when 'Recusado' then 4
                              when 'Cancelado' then 3 when 'Aprovado' then 2 when 'Em análise' then 1 else 0 end as rank_etapa
  from producao_resolvida p
  where p.fonte = 'planilha' and p.tipo = 'novo'
),
plan_casos as (
  select produto,
         coalesce(min(competencia_arquivo) filter (where not herdada), min(competencia_arquivo)) as entrada,
         (array_agg(status_padrao order by rank_etapa desc, competencia_arquivo desc))[1] as etapa,
         (array_agg(imobiliaria_id order by herdada, competencia_arquivo))[1] as imobiliaria_id,
         (array_agg(grupo_id order by herdada, competencia_arquivo))[1] as grupo_id,
         (array_agg(canal order by herdada, competencia_arquivo))[1] as canal_resolvido,
         (array_agg(seguradora order by rank_etapa desc, competencia_arquivo desc))[1] as seguradora,
         (array_agg(premio order by rank_etapa desc, competencia_arquivo desc))[1] as premio,
         (array_agg(comissao order by rank_etapa desc, competencia_arquivo desc))[1] as comissao,
         min(competencia_arquivo) filter (where status_padrao in ('Aprovado', 'Perdido', 'Convertido')) as m_aprovacao,
         min(competencia_arquivo) filter (where status_padrao = 'Recusado') as m_recusa,
         min(competencia_arquivo) filter (where status_padrao = 'Perdido') as m_perda,
         min(competencia_arquivo) filter (where status_padrao = 'Convertido') as m_conversao
  from plan_linhas
  group by chave_caso, produto
),
-- Bitrix: 1 card = 1 linha; as datas dos eventos vêm do histórico de etapas
-- (gravadas pelo scripts/base-unica/sincronizar-bitrix-fianca.ts).
bitrix_casos as (
  select produto, competencia_arquivo as entrada, status_padrao as etapa, imobiliaria_id, grupo_id, canal as canal_resolvido,
         seguradora, premio, comissao,
         left(extras ->> 'data_aprovacao', 7) as m_aprovacao,
         left(extras ->> 'data_recusa', 7) as m_recusa,
         left(extras ->> 'data_perda', 7) as m_perda,
         left(extras ->> 'data_conversao', 7) as m_conversao
  from producao_resolvida
  where fonte = 'bitrix' and tipo = 'novo'
),
casos as (select * from plan_casos union all select * from bitrix_casos),
funil as (
  select 'funil'::text, e.competencia, c.produto, null::text,
         case when e.evento = 'conversao' then producao_seguradora_curta(c.seguradora) end, null::text,
         case when c.canal_resolvido = 'venda_direta_o2' then 'venda_direta'
              when c.imobiliaria_id is not null then 'imobiliaria' else 'nao_identificado' end,
         c.imobiliaria_id, c.grupo_id, e.etapa, e.evento,
         case when e.evento = 'conversao' then c.premio end, case when e.evento = 'conversao' then c.comissao end
  from casos c
  cross join lateral (values ('entrada', c.entrada, c.etapa), ('aprovacao', c.m_aprovacao, null), ('recusa', c.m_recusa, null),
                             ('perda', c.m_perda, null), ('conversao', c.m_conversao, null)) as e(evento, competencia, etapa)
  where e.competencia is not null
)
select origem, competencia, produto, ramo, seguradora, susep, canal, imobiliaria_id, grupo_id, etapa, evento,
       count(*)::int as n,
       coalesce(sum(premio), 0)::numeric(14, 2) as premio,
       coalesce(sum(comissao), 0)::numeric(14, 2) as comissao
from (select * from corp union all select * from funil) x
group by origem, competencia, produto, ramo, seguradora, susep, canal, imobiliaria_id, grupo_id, etapa, evento;

create index producao_painel_mensal_comp_idx on producao_painel_mensal (origem, competencia);
create index producao_painel_mensal_imob_idx on producao_painel_mensal (imobiliaria_id);
create index producao_painel_mensal_grupo_idx on producao_painel_mensal (grupo_id);
revoke all on producao_painel_mensal from anon, authenticated;

-- Quando o resumo foi montado. O painel remonta sozinho ao abrir se houve
-- vínculo confirmado/desfeito ou importação nova depois disso.
create table if not exists producao_painel_estado (
  id int primary key default 1 check (id = 1),
  atualizado_em timestamptz not null default now()
);
alter table producao_painel_estado enable row level security;
revoke all on producao_painel_estado from anon, authenticated;
insert into producao_painel_estado (id) values (1) on conflict (id) do update set atualizado_em = now();

create or replace function atualizar_producao_painel(p_forcar boolean default false) returns timestamptz
language plpgsql security definer set search_path = public
set statement_timeout = '120s' as $$
declare
  v_ultimo timestamptz;
  v_mudou timestamptz;
begin
  if not is_colaborador_o2() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'sem permissão';
  end if;
  select atualizado_em into v_ultimo from producao_painel_estado where id = 1;
  select greatest(
           (select max(updated_at) from imobiliaria_registros_fonte),
           (select max(updated_at) from imobiliaria_grupos),
           (select max(importado_em) from base_unica_importacoes)
         ) into v_mudou;
  if p_forcar or v_ultimo is null or (v_mudou is not null and v_mudou > v_ultimo) then
    refresh materialized view producao_painel_mensal;
    insert into producao_painel_estado (id, atualizado_em) values (1, now())
      on conflict (id) do update set atualizado_em = now();
    return now();
  end if;
  return v_ultimo;
end $$;
revoke all on function atualizar_producao_painel(boolean) from anon, public;
grant execute on function atualizar_producao_painel(boolean) to authenticated;

-- KPIs do painel para um recorte. Datas em 'AAAA-MM'. Filtros vazios/null =
-- todos. Imobiliária: p_grupos (grupo inteiro) e/ou p_imobs (ficha avulsa ou
-- unidade de rede) — com qualquer um preenchido, só entra o que é dessas.
-- Seguradora vale para a produção do Corp (no funil a planilha só registra a
-- seguradora quando converte).
create or replace function kpis_producao(
  p_de text, p_ate text,
  p_produtos text[] default null,
  p_grupos uuid[] default null,
  p_imobs uuid[] default null,
  p_seguradoras text[] default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_filtro_imob boolean := coalesce(cardinality(p_grupos), 0) + coalesce(cardinality(p_imobs), 0) > 0;
  v_meses int := (substr(p_ate, 1, 4)::int * 12 + substr(p_ate, 6, 2)::int) - (substr(p_de, 1, 4)::int * 12 + substr(p_de, 6, 2)::int) + 1;
  v_de_ant text := to_char(to_date(p_de, 'YYYY-MM') - interval '1 year', 'YYYY-MM');
  v_ate_ant text := to_char(to_date(p_ate, 'YYYY-MM') - interval '1 year', 'YYYY-MM');
  r jsonb;
begin
  if not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;

  with base as (
    select m.*, coalesce(m.grupo_id, m.imobiliaria_id) as entidade
    from producao_painel_mensal m
    where (p_produtos is null or cardinality(p_produtos) = 0 or m.produto = any(p_produtos))
      and (not v_filtro_imob or m.grupo_id = any(coalesce(p_grupos, '{}')) or m.imobiliaria_id = any(coalesce(p_imobs, '{}')))
  ),
  prod as (
    select * from base
    where origem = 'producao'
      and (p_seguradoras is null or cardinality(p_seguradoras) = 0 or seguradora = any(p_seguradoras))
  ),
  prod_per as (select * from prod where competencia between p_de and p_ate),
  prod_ant as (select * from prod where competencia between v_de_ant and v_ate_ant),
  fun_per as (select * from base where origem = 'funil' and competencia between p_de and p_ate),
  fun_ant as (select * from base where origem = 'funil' and competencia between v_de_ant and v_ate_ant),
  nomes as (
    select g.id, g.nome, 'grupo'::text as tipo from imobiliaria_grupos g
    union all
    select i.id, coalesce(i.apelido, i.nome), 'imobiliaria' from imobiliarias i
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'meses', v_meses,
    'resumo', (select jsonb_build_object(
        'propostas', coalesce(sum(n), 0), 'premio', coalesce(sum(premio), 0), 'comissao', coalesce(sum(comissao), 0),
        'entidades_ativas', count(distinct entidade)) from prod_per),
    'resumo_ano_anterior', (select jsonb_build_object(
        'de', v_de_ant, 'ate', v_ate_ant,
        'propostas', coalesce(sum(n), 0), 'premio', coalesce(sum(premio), 0), 'comissao', coalesce(sum(comissao), 0),
        'entidades_ativas', count(distinct entidade)) from prod_ant),
    'por_produto', (select coalesce(jsonb_agg(x order by x.premio desc), '[]') from (
        select produto, sum(n) as propostas, sum(premio) as premio, sum(comissao) as comissao,
               (select coalesce(sum(a.premio), 0) from prod_ant a where a.produto = p.produto) as premio_ano_anterior,
               (select coalesce(sum(a.n), 0) from prod_ant a where a.produto = p.produto) as propostas_ano_anterior
        from prod_per p group by produto) x),
    'mensal', (select coalesce(jsonb_agg(x order by x.competencia), '[]') from (
        select competencia,
               jsonb_object_agg(produto, jsonb_build_object('propostas', propostas, 'premio', premio, 'comissao', comissao)) as produtos
        from (select competencia, produto, sum(n) propostas, sum(premio) premio, sum(comissao) comissao
              from prod_per group by 1, 2) y group by competencia) x),
    'por_seguradora', (select coalesce(jsonb_agg(x order by x.premio desc), '[]') from (
        select coalesce(seguradora, 'Não informada') as seguradora, sum(n) as propostas, sum(premio) as premio, sum(comissao) as comissao,
               jsonb_object_agg(produto, n) as produtos
        from (select seguradora, produto, sum(n) n, sum(premio) premio, sum(comissao) comissao
              from prod_per group by 1, 2) y group by 1) x),
    'por_ramo_re', (select coalesce(jsonb_agg(x order by x.premio desc), '[]') from (
        select coalesce(ramo, 'Outros') as ramo, sum(n) as propostas, sum(premio) as premio, sum(comissao) as comissao
        from prod_per where produto = 're' group by 1) x),
    'por_canal', (select coalesce(jsonb_agg(x), '[]') from (
        select canal, sum(n) as propostas, sum(premio) as premio, sum(comissao) as comissao from prod_per group by 1) x),
    'por_susep', (select coalesce(jsonb_agg(x), '[]') from (
        select susep, sum(n) as propostas, sum(premio) as premio from prod_per where susep is not null group by 1) x),
    'por_entidade', (select coalesce(jsonb_agg(x order by x.premio desc), '[]') from (
        select e.entidade as id, nm.nome, nm.tipo, sum(e.n) as propostas, sum(e.premio) as premio, sum(e.comissao) as comissao,
               (select coalesce(sum(a.premio), 0) from prod_ant a where a.entidade = e.entidade) as premio_ano_anterior
        from (select entidade, produto, sum(n) n, sum(premio) premio, sum(comissao) comissao from prod_per where entidade is not null group by 1, 2) e
        left join nomes nm on nm.id = e.entidade
        group by e.entidade, nm.nome, nm.tipo) x),
    -- Cotações (planilhas + Bitrix). Entradas pelo mês em que entraram;
    -- aprovação/recusa/perda/conversão pelo mês do evento (regra do painel /seguro-fianca).
    'funil', (select jsonb_build_object(
        'entradas', coalesce(sum(n) filter (where evento = 'entrada'), 0),
        'aprovacoes', coalesce(sum(n) filter (where evento = 'aprovacao'), 0),
        'recusas', coalesce(sum(n) filter (where evento = 'recusa'), 0),
        'perdas', coalesce(sum(n) filter (where evento = 'perda'), 0),
        'conversoes', coalesce(sum(n) filter (where evento = 'conversao'), 0),
        'premio_convertido', coalesce(sum(premio) filter (where evento = 'conversao'), 0),
        'identificados', coalesce(sum(n) filter (where evento = 'entrada' and canal = 'imobiliaria'), 0),
        'etapa_atual_das_entradas', coalesce((select jsonb_object_agg(etapa, n) from (
            select etapa, sum(n) n from fun_per where evento = 'entrada' group by 1) y), '{}')) from fun_per),
    'funil_ano_anterior', (select jsonb_build_object(
        'entradas', coalesce(sum(n) filter (where evento = 'entrada'), 0),
        'aprovacoes', coalesce(sum(n) filter (where evento = 'aprovacao'), 0),
        'recusas', coalesce(sum(n) filter (where evento = 'recusa'), 0),
        'perdas', coalesce(sum(n) filter (where evento = 'perda'), 0),
        'conversoes', coalesce(sum(n) filter (where evento = 'conversao'), 0)) from fun_ant),
    'funil_mensal', (select coalesce(jsonb_agg(x order by x.competencia), '[]') from (
        select competencia, jsonb_object_agg(evento, n) as eventos
        from (select competencia, evento, sum(n) n from fun_per group by 1, 2) y group by competencia) x),
    'funil_por_entidade', (select coalesce(jsonb_agg(x order by x.entradas desc), '[]') from (
        select f.entidade as id, nm.nome, nm.tipo,
               coalesce(sum(f.n) filter (where f.evento = 'entrada'), 0) as entradas,
               coalesce(sum(f.n) filter (where f.evento = 'aprovacao'), 0) as aprovacoes,
               coalesce(sum(f.n) filter (where f.evento = 'recusa'), 0) as recusas,
               coalesce(sum(f.n) filter (where f.evento = 'perda'), 0) as perdas,
               coalesce(sum(f.n) filter (where f.evento = 'conversao'), 0) as conversoes,
               coalesce(sum(f.premio) filter (where f.evento = 'conversao'), 0) as premio_convertido
        from fun_per f left join nomes nm on nm.id = f.entidade
        where f.entidade is not null
        group by f.entidade, nm.nome, nm.tipo) x),
    'funil_meses_com_planilha', (select coalesce(jsonb_agg(distinct competencia order by competencia), '[]')
        from base_unica_importacoes where produto = 'fianca' and layout <> 'corp_relatorio_propostas' and competencia between p_de and p_ate),
    'atualizado_em', (select atualizado_em from producao_painel_estado where id = 1)
  ) into r;
  return r;
end $$;
revoke all on function kpis_producao(text, text, text[], uuid[], uuid[], text[]) from anon, public;
grant execute on function kpis_producao(text, text, text[], uuid[], uuid[], text[]) to authenticated;

-- Opções do filtro de imobiliária: grupos e fichas com alguma produção ou
-- análise no resumo. Membro de grupo "mesma empresa" não aparece sozinho (é uma
-- imobiliária só); unidade de rede aparece, além da rede inteira.
create or replace function opcoes_filtro_producao() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  return (
    with vol as (
      select imobiliaria_id, grupo_id, sum(premio) premio, sum(n) n
      from producao_painel_mensal where imobiliaria_id is not null group by 1, 2
    )
    select coalesce(jsonb_agg(x order by x.premio desc), '[]') from (
      select g.id, g.nome, 'grupo' as tipo, g.tipo as tipo_grupo, null::uuid as grupo_id, sum(v.premio) premio, sum(v.n) n
      from imobiliaria_grupos g join vol v on v.grupo_id = g.id group by g.id, g.nome, g.tipo
      union all
      select i.id, coalesce(i.apelido, i.nome), 'imobiliaria', null, i.grupo_id, sum(v.premio), sum(v.n)
      from imobiliarias i join vol v on v.imobiliaria_id = i.id
      left join imobiliaria_grupos g on g.id = i.grupo_id
      where i.grupo_id is null or g.tipo = 'rede_filiais'
      group by i.id, i.apelido, i.nome, i.grupo_id
    ) x
  );
end $$;
revoke all on function opcoes_filtro_producao() from anon, public;
grant execute on function opcoes_filtro_producao() to authenticated;

-- Troca de grupo numa ficha (imobiliarias.grupo_id) não tem updated_at: marca o
-- resumo como desatualizado para o painel remontar na próxima abertura.
create or replace function producao_painel_marcar_desatualizado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update producao_painel_estado set atualizado_em = '-infinity' where id = 1;
  return null;
end $$;
revoke all on function producao_painel_marcar_desatualizado() from anon, public, authenticated;
drop trigger if exists imobiliarias_grupo_producao_painel on imobiliarias;
create trigger imobiliarias_grupo_producao_painel
  after update of grupo_id on imobiliarias
  for each statement execute function producao_painel_marcar_desatualizado();
