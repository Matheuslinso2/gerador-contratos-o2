-- =====================================================================
-- Power BI - O2 Seguros — leitura das telas (/producao/geral, /historica,
-- /flash, /sinistros, /inconsistencias). Roda DEPOIS de
-- schema_corp_sharepoint.sql. Só lê os retratos mensais (mês fechado
-- congelado); as regras (ramo, seguradora, centralizador, origem) são
-- resolvidas na leitura, como as dimensões do Power BI.
-- =====================================================================

alter table corp_regra_produtor add column if not exists nome_no_sharepoint text;

create index if not exists corp_grade_incluir_nosso_idx on corp_grade(nosso_numero) where incluir_corretora;

create or replace view corp_retrato_producao_dim with (security_invoker = true) as
select p.*,
  coalesce(r.agrupamento_pai, 'SEM GRUPO') as grupo_ramo,
  coalesce(r.agrupamento_filho, nullif(p.ramo, ''), 'SEM RAMO') as ramo_filho,
  coalesce(r.agrupamento_flash, 'OUTROS') as ramo_flash,
  coalesce(s.abreviado, nullif(p.seg, ''), 'SEM SEGURADORA') as seguradora,
  coalesce(c.centralizador, nullif(p.produtor, ''), 'SEM PRODUTOR') as centralizador,
  coalesce(c.origem, 'SEM ORIGEM') as origem
from corp_retrato_producao p
left join corp_regra_ramo r on r.id_ramo = p.ramo
left join corp_regra_seguradora s on s.id_seguradora = p.seg
left join corp_regra_produtor c on c.produtor = p.produtor;

create or replace view corp_retrato_sinistros_dim with (security_invoker = true) as
select p.*,
  coalesce(r.agrupamento_pai, 'SEM GRUPO') as grupo_ramo,
  coalesce(r.agrupamento_filho, nullif(p.ramo, ''), 'SEM RAMO') as ramo_filho,
  coalesce(s.abreviado, nullif(p.seg, ''), 'SEM SEGURADORA') as seguradora
from corp_retrato_sinistros p
left join corp_regra_ramo r on r.id_ramo = p.ramo
left join corp_regra_seguradora s on s.id_seguradora = p.seg;

-- Filtro comum (null = sem filtro).
create or replace function corp_passa_filtro(
  d corp_retrato_producao_dim, p_seg text[], p_grupo text[], p_ramo text[], p_central text[], p_produtor text[], p_origem text[], p_tipo text[], p_cancelado text[]
) returns boolean language sql immutable as $$
  select (p_seg is null or d.seguradora = any(p_seg))
     and (p_grupo is null or d.grupo_ramo = any(p_grupo))
     and (p_ramo is null or d.ramo_filho = any(p_ramo))
     and (p_central is null or d.centralizador = any(p_central))
     and (p_produtor is null or d.produtor = any(p_produtor))
     and (p_origem is null or d.origem = any(p_origem))
     and (p_tipo is null or d.tipo = any(p_tipo))
     and (p_cancelado is null or d.cancelado = any(p_cancelado))
$$;

-- Opções dos filtros.
create or replace function corp_opcoes_filtro() returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'seguradoras', (select jsonb_agg(distinct seguradora order by seguradora) from corp_retrato_producao_dim where base = 'corretora'),
    'grupos', (select jsonb_agg(distinct grupo_ramo order by grupo_ramo) from corp_retrato_producao_dim where base = 'corretora'),
    'ramos', (select jsonb_agg(distinct ramo_filho order by ramo_filho) from corp_retrato_producao_dim where base = 'corretora'),
    'centralizadores', (select jsonb_agg(distinct centralizador order by centralizador) from corp_retrato_producao_dim where base = 'corretora'),
    'produtores', (select jsonb_agg(distinct produtor order by produtor) from corp_retrato_producao where base = 'corretora' and produtor <> ''),
    'origens', (select jsonb_agg(distinct origem order by origem) from corp_retrato_producao_dim where base = 'corretora'),
    'ramos_flash', (select jsonb_agg(codigo order by ordem) from corp_dominio where dominio = 'agrupamento_flash'),
    'meses', (select jsonb_agg(to_char(mes, 'YYYY-MM') order by mes) from corp_retrato_meses where assunto = 'producao'),
    'situacoes', (select jsonb_agg(jsonb_build_object('codigo', codigo, 'descricao', descricao) order by ordem) from corp_dominio where dominio = 'situacao_sinistro'),
    'importado_em', (select max(importado_em) from corp_sp_arquivos),
    'arquivo_modificado_em', (select max(sp_modificado_em) from corp_sp_arquivos where tipo = 'grade')
  )
$$;

-- Produção Geral: cartões (mês, mês anterior, ano anterior, YTD e comparativos) e quebras do mês e do YTD.
create or replace function corp_painel_geral(
  p_mes date, p_seg text[] default null, p_grupo text[] default null, p_ramo text[] default null, p_central text[] default null,
  p_produtor text[] default null, p_origem text[] default null, p_tipo text[] default null, p_cancelado text[] default null
) returns jsonb language sql stable set search_path = public as $$
  with par as (
    select date_trunc('month', p_mes)::date as m,
           (date_trunc('month', p_mes) - interval '1 month')::date as m_ant,
           (date_trunc('month', p_mes) - interval '1 year')::date as a_ant
  ),
  d as (
    select x.* from corp_retrato_producao_dim x, par
    where x.base = 'corretora'
      and x.mes between least(date_trunc('year', par.a_ant)::date, date_trunc('year', par.m_ant)::date) and par.m
      and corp_passa_filtro(x, p_seg, p_grupo, p_ramo, p_central, p_produtor, p_origem, p_tipo, p_cancelado)
  ),
  per as (
    select 'mes' k, m de, m ate from par union all
    select 'mes_ant', m_ant, m_ant from par union all
    select 'ano_ant', a_ant, a_ant from par union all
    select 'ytd', date_trunc('year', m)::date, m from par union all
    select 'ytd_mes_ant', date_trunc('year', m_ant)::date, m_ant from par union all
    select 'ytd_ano_ant', date_trunc('year', a_ant)::date, a_ant from par
  ),
  cartoes as (
    select jsonb_object_agg(per.k, jsonb_build_object(
      'docs', coalesce((select sum(documentos) from d where d.mes between per.de and per.ate), 0),
      'com', coalesce((select sum(vl_com) from d where d.mes between per.de and per.ate), 0),
      'pl', coalesce((select sum(pr_liquido) from d where d.mes between per.de and per.ate), 0))) j
    from per
  ),
  quebra as (
    select janela, dim, jsonb_agg(jsonb_build_object('k', k, 'docs', docs, 'com', com) order by docs desc) j
    from (
      select w.janela, v.dim, v.k, sum(d.documentos) docs, sum(d.vl_com) com
      from par, d
      cross join lateral (values ('mes', par.m, par.m), ('ytd', date_trunc('year', par.m)::date, par.m)) w(janela, de, ate)
      cross join lateral (values ('tipo', d.tipo), ('cancelado', d.cancelado), ('grupo', d.grupo_ramo), ('ramo', d.ramo_filho),
                                 ('seguradora', d.seguradora), ('centralizador', d.centralizador), ('produtor', d.produtor),
                                 ('origem', d.origem), ('parcelas', d.faixa_parcelas)) v(dim, k)
      where d.mes between w.de and w.ate
      group by 1, 2, 3
    ) t group by 1, 2
  )
  select jsonb_build_object(
    'mes', to_char(p_mes, 'YYYY-MM'),
    'cartoes', (select j from cartoes),
    'quebras', (select jsonb_object_agg(janela, q) from (select janela, jsonb_object_agg(dim, j) q from quebra group by janela) z)
  )
$$;

-- Produção Histórica: série mensal com as filtragens (corretora + comissão do produtor).
create or replace function corp_painel_historico(
  p_seg text[] default null, p_grupo text[] default null, p_ramo text[] default null, p_central text[] default null,
  p_produtor text[] default null, p_origem text[] default null, p_tipo text[] default null, p_cancelado text[] default null
) returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'mes', to_char(mes, 'YYYY-MM'), 'docs', docs, 'pl', pl, 'com', com, 'com_prod', com_prod,
      's_com', s_com, 'n_com', n_com, 's_prod', s_prod, 'n_prod', n_prod) order by mes), '[]'::jsonb)
  from (
    select mes,
      sum(documentos) filter (where base = 'corretora') docs,
      sum(pr_liquido) filter (where base = 'corretora') pl,
      sum(vl_com) filter (where base = 'corretora') com,
      sum(vl_com_prod) filter (where base = 'produtor') com_prod,
      sum(soma_pct_com_pos) filter (where base = 'corretora') s_com, sum(n_pct_com_pos) filter (where base = 'corretora') n_com,
      sum(soma_pct_prod_pos) filter (where base = 'produtor') s_prod, sum(n_pct_prod_pos) filter (where base = 'produtor') n_prod
    from corp_retrato_producao_dim x
    where base in ('corretora', 'produtor')
      and corp_passa_filtro(x, p_seg, p_grupo, p_ramo, p_central, p_produtor, p_origem, p_tipo, p_cancelado)
    group by mes
  ) t
$$;

-- Flash Report de um mês. Docs cancelados = tipo de operação CANC (como no PBI).
create or replace function corp_painel_flash(p_mes date, p_ramo_flash text[] default null)
returns jsonb language sql stable set search_path = public as $$
  with par as (
    select date_trunc('month', p_mes)::date m, (date_trunc('month', p_mes) - interval '1 month')::date m_ant,
           (date_trunc('month', p_mes) - interval '1 year')::date a_ant, date_trunc('year', p_mes)::date ini
  ),
  d as (
    select x.* from corp_retrato_producao_dim x, par
    where x.mes between (par.ini - interval '1 year')::date and par.m
      and (p_ramo_flash is null or x.ramo_flash = any(p_ramo_flash))
  ),
  metas as (
    select agrupamento_flash ramo_flash,
      sum(com_corretora) filter (where mes = (select m from par)) meta_mes,
      sum(com_corretora) filter (where mes between (select ini from par) and (select m from par)) meta_ytd
    from corp_meta_comissao where p_ramo_flash is null or agrupamento_flash = any(p_ramo_flash)
    group by 1
  ),
  por_ramo as (
    select coalesce(t.ramo_flash, me.ramo_flash) ramo_flash, t.mes_com, t.aa_com, t.ytd_com, t.ytd_aa_com, t.docs, t.pl,
           coalesce(me.meta_mes, 0) meta_mes, coalesce(me.meta_ytd, 0) meta_ytd
    from (
      select ramo_flash,
        sum(vl_com) filter (where mes = par.m) mes_com,
        sum(vl_com) filter (where mes = par.a_ant) aa_com,
        sum(vl_com) filter (where mes between par.ini and par.m) ytd_com,
        sum(vl_com) filter (where mes between (par.ini - interval '1 year')::date and par.a_ant) ytd_aa_com,
        sum(documentos) filter (where mes = par.m) docs,
        sum(pr_liquido) filter (where mes = par.m) pl
      from d, par where base = 'corretora' group by 1
    ) t full join metas me on me.ramo_flash = t.ramo_flash
  ),
  bloco as (
    select 'endossos' bloco, ramo_flash chave,
      sum(vl_com) filter (where mes = par.m) mes_com, sum(vl_com) filter (where mes = par.a_ant) aa_com,
      sum(documentos) filter (where mes = par.m) docs, sum(pr_liquido) filter (where mes = par.m) pl
    from d, par where base = 'corretora' and endosso group by 1, 2
    union all
    select lower(replace(produtor, 'Ã', 'A')), ramo_flash,
      sum(vl_com) filter (where mes = par.m), sum(vl_com) filter (where mes = par.a_ant),
      sum(documentos) filter (where mes = par.m), sum(pr_liquido) filter (where mes = par.m)
    from d, par where base = 'excecao' group by 1, 2
    union all
    select 'renascenca', ramo_flash,
      sum(vl_com) filter (where mes = par.m), sum(vl_com) filter (where mes = par.a_ant),
      sum(documentos) filter (where mes = par.m), sum(pr_liquido) filter (where mes = par.m)
    from d, par where base = 'corretora' and centralizador = 'RENASCENÇA' group by 1, 2
  ),
  cart as (
    select
      sum(vl_com) filter (where mes = par.m) com_mes, sum(vl_com) filter (where mes = par.m_ant) com_mes_ant,
      sum(vl_com) filter (where mes = par.a_ant) com_ano_ant,
      sum(vl_com) filter (where mes between par.ini and par.m) com_ytd,
      sum(vl_com) filter (where mes between (date_trunc('year', par.m_ant))::date and par.m_ant) com_ytd_mes_ant,
      sum(vl_com) filter (where mes between (par.ini - interval '1 year')::date and par.a_ant) com_ytd_ano_ant,
      sum(pr_liquido) filter (where mes = par.m and ramo_flash = 'CAPITALIZAÇÃO') pl_cap_mes,
      sum(pr_liquido) filter (where mes = par.m_ant and ramo_flash = 'CAPITALIZAÇÃO') pl_cap_mes_ant,
      sum(pr_liquido) filter (where mes = par.a_ant and ramo_flash = 'CAPITALIZAÇÃO') pl_cap_ano_ant,
      sum(documentos) filter (where mes = par.m) docs_mes, sum(documentos) filter (where mes = par.m_ant) docs_mes_ant,
      sum(documentos) filter (where mes = par.a_ant) docs_ano_ant,
      sum(documentos) filter (where mes = par.m and tipo = 'CANC') canc_mes,
      sum(documentos) filter (where mes = par.m_ant and tipo = 'CANC') canc_mes_ant,
      sum(documentos) filter (where mes = par.a_ant and tipo = 'CANC') canc_ano_ant
    from d, par where base = 'corretora'
  ),
  sin as (
    select sum(casos) filter (where mes = par.m) mes, sum(casos) filter (where mes = par.m_ant) mes_ant,
           sum(casos) filter (where mes = par.a_ant) ano_ant
    from corp_retrato_sinistros s, par where s.mes in (par.m, par.m_ant, par.a_ant)
  ),
  ana as (
    select sum(qtde_analise_acumulada) filter (where date_trunc('month', data_atualizacao) = par.m) analise_mes,
           sum(qtde_recusado_acumulada) filter (where date_trunc('month', data_atualizacao) = par.m) recusado_mes,
           sum(qtde_analise_acumulada) filter (where date_trunc('month', data_atualizacao) = par.m_ant) analise_mes_ant,
           sum(qtde_analise_acumulada) filter (where date_trunc('month', data_atualizacao) = par.a_ant) analise_ano_ant
    from corp_analise_recusado, par
  )
  select jsonb_build_object(
    'mes', to_char(p_mes, 'YYYY-MM'),
    'cartoes', (select to_jsonb(cart) from cart) || (select jsonb_build_object('sin_mes', mes, 'sin_mes_ant', mes_ant, 'sin_ano_ant', ano_ant) from sin)
               || (select to_jsonb(ana) from ana),
    'por_ramo', (select coalesce(jsonb_agg(to_jsonb(r) order by coalesce(dm.ordem, 99)), '[]') from por_ramo r
                 left join corp_dominio dm on dm.dominio = 'agrupamento_flash' and dm.codigo = r.ramo_flash),
    'blocos', (select coalesce(jsonb_object_agg(bloco, linhas), '{}') from
                (select bloco, jsonb_agg(jsonb_build_object('chave', chave, 'mes_com', mes_com, 'aa_com', aa_com, 'docs', docs, 'pl', pl)
                   order by chave) linhas from bloco group by bloco) b)
  )
$$;

-- Sinistros de um período.
create or replace function corp_painel_sinistros(
  p_de date default null, p_ate date default null, p_seg text[] default null, p_ramo text[] default null,
  p_situacao text[] default null, p_faixa text[] default null
) returns jsonb language sql stable set search_path = public as $$
  with d as (
    select * from corp_retrato_sinistros_dim
    where (p_de is null or mes >= date_trunc('month', p_de)) and (p_ate is null or mes <= date_trunc('month', p_ate))
      and (p_seg is null or seguradora = any(p_seg)) and (p_ramo is null or ramo_filho = any(p_ramo))
      and (p_situacao is null or situacao = any(p_situacao)) and (p_faixa is null or faixa_valor = any(p_faixa))
  )
  select jsonb_build_object(
    'totais', (select jsonb_build_object('casos', coalesce(sum(casos),0), 'casos_ind', coalesce(sum(casos_ind),0),
        'casos_desp', coalesce(sum(casos_desp),0), 'casos_valor', coalesce(sum(casos_valor),0), 'casos_0800', coalesce(sum(casos_0800),0),
        'vl_inden', coalesce(sum(vl_inden),0), 'vl_despesas', coalesce(sum(vl_despesas),0), 'meses', count(distinct mes)) from d),
    'por_situacao', (select coalesce(jsonb_agg(jsonb_build_object('k', situacao, 'casos', c, 'valor', v) order by c desc), '[]') from
        (select situacao, sum(casos) c, sum(vl_inden + vl_despesas) v from d group by 1) t),
    'por_faixa', (select coalesce(jsonb_agg(jsonb_build_object('k', faixa_valor, 'casos', c, 'valor', v)), '[]') from
        (select faixa_valor, sum(casos) c, sum(vl_inden + vl_despesas) v from d group by 1) t),
    'por_ramo', (select coalesce(jsonb_agg(jsonb_build_object('k', ramo_filho, 'casos', c, 'valor', v) order by c desc), '[]') from
        (select ramo_filho, sum(casos) c, sum(vl_inden + vl_despesas) v from d group by 1) t),
    'por_grupo', (select coalesce(jsonb_agg(jsonb_build_object('grupo', grupo_ramo, 'ramo', ramo_filho, 'casos', c, 'inden', i, 'desp', dd) order by grupo_ramo, c desc), '[]') from
        (select grupo_ramo, ramo_filho, sum(casos) c, sum(vl_inden) i, sum(vl_despesas) dd from d group by 1, 2) t),
    'mensal', (select coalesce(jsonb_agg(jsonb_build_object('mes', to_char(mes, 'YYYY-MM'), 'casos', c, 'inden', i, 'desp', dd) order by mes), '[]') from
        (select mes, sum(casos) c, sum(vl_inden) i, sum(vl_despesas) dd from d group by 1) t)
  )
$$;

-- Inconsistências (security definer: a varredura da grade sob RLS linha a linha passava de 8 s).
create or replace function corp_painel_inconsistencias() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user <> 'postgres' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  select jsonb_build_object(
    'duplicidades', (select coalesce(jsonb_agg(jsonb_build_object('nosso_numero', g.nosso_numero, 'produtor', g.produtor, 'ramo', g.ramo,
          'ini_vig', g.ini_vig, 'pr_liquido', g.pr_liquido, 'vl_com', g.vl_com) order by g.nosso_numero), '[]')
        from corp_grade g where g.incluir_corretora and g.nosso_numero in
          (select nosso_numero from corp_grade where incluir_corretora group by 1 having count(*) > 1)),
    'ausentes', (select coalesce(jsonb_agg(jsonb_build_object('produtor', produtor, 'agente', agente, 'linhas', n, 'ultima_vigencia', ult) order by n desc), '[]')
        from (select g.produtor, max(g.agente) agente, count(*) n, max(g.ini_vig) ult from corp_grade g
              where g.produtor is not null and not exists (select 1 from corp_regra_produtor r where r.produtor = g.produtor) group by 1) t),
    'nomes_com_espaco', (select coalesce(jsonb_agg(jsonb_build_object('nome', produtor, 'classe', entra_base_com_corretora) order by produtor), '[]')
        from corp_regra_produtor where produtor <> btrim(produtor))
  ) into r;
  return r;
end $$;
revoke all on function corp_painel_inconsistencias() from public, anon;

grant execute on function corp_opcoes_filtro(), corp_painel_geral(date, text[], text[], text[], text[], text[], text[], text[], text[]),
  corp_painel_historico(text[], text[], text[], text[], text[], text[], text[], text[]), corp_painel_flash(date, text[]),
  corp_painel_sinistros(date, date, text[], text[], text[], text[]), corp_painel_inconsistencias() to authenticated;
