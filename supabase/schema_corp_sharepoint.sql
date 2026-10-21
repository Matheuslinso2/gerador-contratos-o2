-- =====================================================================
-- Corp via SharePoint (mesma fonte do Power BI "PBI O2 SEGUROS - PRODUÇÃO CORP")
-- =====================================================================
-- Fonte: site SharePoint analyticspwb ("O2 Data Analytics"), pasta
-- Documentos Compartilhados/01. BASES DE DADOS/01. EXTRAÇÕES CORP, onde a
-- equipe deposita as extrações do Corp (grade_prods_AAAA-AAAA.xlsx,
-- sinistros_grade.xlsx, Clientes Com Documentos.xlsx), + listas do
-- SharePoint com as regras (cadastro de produtores, ramos, seguradoras,
-- metas, análises/recusas). Regras de negócio reproduzidas da documentação
-- da Cronomics ("Documentação PBI Produção CORP"):
--   * data da produção = Início de Vigência; prêmio = líquido;
--   * deduplicação por Nosso Nº pela hierarquia ENTRA > TRATAR N1 > TRATAR N2
--     (coluna entra_base_com_corretora do cadastro de produtores);
--     produtor fora do cadastro não entra; NÃO ENTRA é descartado;
--   * base do produtor = só linhas com entra_base_com_produtor = ENTRA.
-- Mês fechado congela (regra do Workspace): o retrato mensal de um mês
-- encerrado é gravado uma vez; diferenças que aparecerem depois na fonte
-- viram registro em corp_alteracoes_pos_fechamento, sem reescrever o mês.
-- Só colaborador O2. Gravação só pelo service_role (importador/cron).
-- =====================================================================

-- ---------- Arquivos lidos (controle de importação) ----------
create table if not exists corp_sp_arquivos (
  id text primary key,                       -- ex.: 'grade:grade_prods_2026.xlsx'
  tipo text not null check (tipo in ('grade','sinistros','clientes','cidades')),
  nome text not null,
  pasta text,
  origem text not null default 'sharepoint' check (origem in ('sharepoint','arquivo_local')),
  sp_modificado_em timestamptz,              -- "Modificado" do SharePoint
  sp_etag text,
  tamanho_bytes bigint,
  md5 text,
  linhas int,
  importado_em timestamptz not null default now(),
  observacao text
);

-- ---------- Linhas da grade "Propostas Grade por Produtor" ----------
-- Uma linha por linha da planilha (o Corp repete a proposta para cada
-- produtor envolvido). Sem nome/CPF do cliente (já estão no cofre).
create table if not exists corp_grade (
  id bigint generated always as identity primary key,
  arquivo_id text not null references corp_sp_arquivos(id) on delete cascade,
  codigo_produtor int,
  agente text,
  produtor text,                             -- já com trim (como o Power BI)
  filial text,
  nosso_numero bigint not null,
  seg text,
  ramo text,
  numero_apolice text,
  numero_endosso text,
  ini_vig date,
  fim_vig date,
  dt_proposta date,
  parcelas int,
  pr_liquido numeric(14,2),
  pr_adicional numeric(14,2),
  vl_com numeric(14,2),
  pct_com numeric(9,4),
  vl_com_prod numeric(14,2),
  pct_com_prod numeric(9,4),
  base_com_corretora numeric(14,2),
  pr_total numeric(14,2),
  tipo text,                                 -- NOVO/RENV/END/FAT/CANC
  cancelado text,                            -- F (vigente) / T (cancelado)
  canal_vendas text,
  -- marcados por corp_marcar_deduplicacao() a cada importação/sincronização de regras:
  classe_corretora text,                     -- entra_base_com_corretora do produtor (null = fora do cadastro)
  incluir_corretora boolean not null default false,
  incluir_produtor boolean not null default false
);
create index if not exists corp_grade_arquivo_idx on corp_grade(arquivo_id);
create index if not exists corp_grade_nosso_idx on corp_grade(nosso_numero);
create index if not exists corp_grade_ini_vig_idx on corp_grade(ini_vig);

-- ---------- Sinistros "Geral – Grade" ----------
create table if not exists corp_sinistros (
  id bigint generated always as identity primary key,
  arquivo_id text not null references corp_sp_arquivos(id) on delete cascade,
  tipo text,
  nosso_numero bigint,
  seg text,
  ramo text,
  apolice text,
  item int,
  numero_sinistro text,
  dt_ocor date,
  dt_aviso date,
  vl_avisado numeric(14,2),
  situacao text,                             -- A/E/I/P
  dt_encer date,
  vl_inden numeric(14,2),
  vl_despesas numeric(14,2),
  produtor text,
  cobertura text
);
create index if not exists corp_sinistros_arquivo_idx on corp_sinistros(arquivo_id);
create index if not exists corp_sinistros_dt_ocor_idx on corp_sinistros(dt_ocor);

-- ---------- Clientes com Documentos (só o necessário: tipo de documento e praça) ----------
create table if not exists corp_documentos (
  nosso_numero bigint primary key,
  arquivo_id text not null references corp_sp_arquivos(id) on delete cascade,
  tipo_doc text,                             -- A/C/D/F/I/M/R/X (endosso = C/I/M/R/X)
  uf text,
  cidade text
);
create index if not exists corp_documentos_arquivo_idx on corp_documentos(arquivo_id);

-- ---------- Regras (espelho das listas do SharePoint) ----------
create table if not exists corp_regra_produtor (
  produtor text primary key,                 -- nome exatamente como no Corp
  entra_base_com_corretora text,             -- ENTRA / TRATAR N1 / TRATAR N2 / NÃO ENTRA
  entra_base_com_produtor text,
  origem text,
  centralizador_parceiro text,
  centralizador text generated always as (
    case when centralizador_parceiro is null or btrim(centralizador_parceiro) in ('', 'SEM CENTRALIZADOR', 'RETIRAR', 'N/A')
         then produtor else centralizador_parceiro end) stored,
  filial text,
  corretor text,
  tipo_pessoa text,
  sistemas jsonb not null default '{}'::jsonb, -- colunas por produto (capitalização, fiança…)
  sp_item_id int,
  sincronizado_em timestamptz not null default now()
);

create table if not exists corp_regra_ramo (
  id_ramo text primary key,
  descricao text,
  agrupamento_pai text,
  agrupamento_filho text,
  agrupamento_flash text,
  sincronizado_em timestamptz not null default now()
);

create table if not exists corp_regra_seguradora (
  id_seguradora text primary key,
  seguradora text,
  abreviado text,
  sincronizado_em timestamptz not null default now()
);

create table if not exists corp_meta_comissao (
  agrupamento_flash text not null,
  mes date not null,                         -- 1º dia do mês
  com_corretora numeric(14,2) not null,
  sincronizado_em timestamptz not null default now(),
  primary key (agrupamento_flash, mes)
);

create table if not exists corp_analise_recusado (
  data_atualizacao date not null,
  ramo text not null,
  qtde_analise_acumulada int,
  qtde_recusado_acumulada int,
  sincronizado_em timestamptz not null default now(),
  primary key (data_atualizacao, ramo)
);

create table if not exists corp_cidade_padrao (
  uf_cidade_corp text primary key,           -- "UF_CIDADE" em caixa alta, como o Corp escreve
  uf text,
  cidade text
);

-- Domínios fixos do Power BI (tabelas estáticas do modelo)
create table if not exists corp_dominio (
  dominio text not null,                     -- tipo / tipo_doc / cancelado / situacao_sinistro / agrupamento_flash / faixa_valor_sinistro
  codigo text not null,
  descricao text not null,
  extra text,
  ordem int,
  primary key (dominio, codigo)
);
insert into corp_dominio (dominio, codigo, descricao, extra, ordem) values
  ('tipo','CANC','CANCELADO',null,5),('tipo','END','ENDOSSO',null,4),('tipo','FAT','FATURADO',null,3),
  ('tipo','NOVO','NOVO',null,2),('tipo','RENV','RENOVADO',null,1),
  ('tipo_doc','A','APÓLICE','NÃO',1),('tipo_doc','C','ENDOSSO DE COBRANÇA','SIM',2),('tipo_doc','D','DEVOLUÇÃO DE DOC.','NÃO',3),
  ('tipo_doc','F','FATURA','NÃO',4),('tipo_doc','I','END. CANCEL. DE ITEM','SIM',5),('tipo_doc','M','ENDOSSO SEM PRÊMIO','SIM',6),
  ('tipo_doc','R','ENDOSSO DE RESTITUIÇÃO','SIM',7),('tipo_doc','X','END. CANCEL. DE APÓLICE','SIM',8),
  ('cancelado','F','VIGENTE',null,1),('cancelado','T','CANCELADO',null,2),
  ('situacao_sinistro','A','EM ANDAMENTO',null,3),('situacao_sinistro','E','ENCER. S/ INDENIZAÇÃO',null,2),
  ('situacao_sinistro','I','INDENIZADOS',null,1),('situacao_sinistro','P','PENDENTES',null,4),
  ('agrupamento_flash','FIANÇA','FIANÇA',null,1),('agrupamento_flash','CAPITALIZAÇÃO','CAPITALIZAÇÃO',null,2),
  ('agrupamento_flash','INCÊNDIO','INCÊNDIO',null,3),('agrupamento_flash','AUTO','AUTO',null,4),
  ('agrupamento_flash','CONDOMÍNIO','CONDOMÍNIO',null,5),('agrupamento_flash','PREMIAÇÃO','PREMIAÇÃO',null,6),
  ('agrupamento_flash','OUTROS','OUTROS',null,7),
  ('faixa_valor_sinistro','SEM VALOR','SEM VALOR',null,1),('faixa_valor_sinistro','MENOR QUE 1K','MENOR QUE 1K',null,2),
  ('faixa_valor_sinistro','ENTRE 1K E 5K','ENTRE 1K E 5K',null,3),('faixa_valor_sinistro','ENTRE 5K E 10K','ENTRE 5K E 10K',null,4),
  ('faixa_valor_sinistro','MAIOR QUE 10K','MAIOR QUE 10K',null,5)
on conflict (dominio, codigo) do update set descricao = excluded.descricao, extra = excluded.extra, ordem = excluded.ordem;

-- ---------- Produção tratada (mesma regra do Power BI) ----------
-- Marca, em todas as linhas da grade, quais entram em cada base. Uma
-- passada só (rodar após importar a grade ou sincronizar o cadastro).
--  incluir_corretora (f_ProducaoCorretora): 1 linha por Nosso Nº, no produtor
--    de maior prioridade ENTRA > TRATAR N1 > TRATAR N2; produtor fora do
--    cadastro ou NÃO ENTRA não entra.
--  incluir_produtor (f_ProducaoProdutor): entra_base_com_produtor = ENTRA.
create or replace function corp_marcar_deduplicacao()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_linhas int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user <> 'postgres' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  with base as (
    select g.id, g.nosso_numero, p.entra_base_com_corretora as classe, p.entra_base_com_produtor as classe_prod,
           (g.ramo is not null and g.ramo <> 'Ramo') as valida
    from corp_grade g left join corp_regra_produtor p on p.produtor = g.produtor
  ),
  marcas as (
    select nosso_numero, bool_or(classe = 'ENTRA') as tem_entra, bool_or(classe = 'TRATAR N1') as tem_n1
    from base where valida group by nosso_numero
  ),
  decisao as (
    select b.id, b.classe,
      coalesce(b.valida and (b.classe = 'ENTRA'
        or (b.classe = 'TRATAR N1' and not m.tem_entra)
        or (b.classe = 'TRATAR N2' and not m.tem_entra and not m.tem_n1)), false) as inc_c,
      coalesce(b.valida and b.classe_prod = 'ENTRA', false) as inc_p
    from base b left join marcas m using (nosso_numero)
  )
  update corp_grade g set classe_corretora = d.classe, incluir_corretora = d.inc_c, incluir_produtor = d.inc_p
  from decisao d
  where g.id = d.id
    and (g.classe_corretora is distinct from d.classe or g.incluir_corretora <> d.inc_c or g.incluir_produtor <> d.inc_p);
  get diagnostics v_linhas = row_count;
  return jsonb_build_object('linhas_alteradas', v_linhas);
end $$;
revoke all on function corp_marcar_deduplicacao() from public, anon;
grant execute on function corp_marcar_deduplicacao() to authenticated, service_role;

create or replace view corp_producao_corretora with (security_invoker = true) as
select g.*,
  case when g.parcelas <= 1 then '00 - 01' when g.parcelas <= 12 then '02 - 12'
       when g.parcelas <= 24 then '13 - 24' when g.parcelas > 24 then 'Mais de 24' end as faixa_parcelas
from corp_grade g where g.incluir_corretora;

create or replace view corp_producao_produtor with (security_invoker = true) as
select g.* from corp_grade g where g.incluir_produtor;

-- ---------- Retratos mensais (o que as telas leem) ----------
-- base: 'corretora' (deduplicada), 'produtor' (comissão do produtor),
--       'excecao' (SEGIMOB / SUPERLOGICA / RETRANSMISSÃO antes da deduplicação, como no Flash Report).
create table if not exists corp_retrato_producao (
  mes date not null,
  base text not null check (base in ('corretora','produtor','excecao')),
  ramo text not null default '',
  seg text not null default '',
  produtor text not null default '',
  tipo text not null default '',
  cancelado text not null default '',
  faixa_parcelas text not null default '',
  endosso boolean not null default false,
  documentos int not null default 0,
  pr_liquido numeric(16,2) not null default 0,
  pr_total numeric(16,2) not null default 0,
  vl_com numeric(16,2) not null default 0,
  vl_com_prod numeric(16,2) not null default 0,
  soma_pct_com_pos numeric(16,4) not null default 0,  -- p/ "média % comissão" (só > 0)
  n_pct_com_pos int not null default 0,
  soma_pct_prod_pos numeric(16,4) not null default 0,
  n_pct_prod_pos int not null default 0,
  primary key (mes, base, ramo, seg, produtor, tipo, cancelado, faixa_parcelas, endosso)
);

create table if not exists corp_retrato_sinistros (
  mes date not null,                         -- mês da ocorrência
  seg text not null default '',
  ramo text not null default '',
  situacao text not null default '',
  faixa_valor text not null default '',
  produtor text not null default '',
  casos int not null default 0,
  casos_ind int not null default 0,          -- Vl. Inden. <> 0
  casos_desp int not null default 0,         -- Vl. Despesas <> 0
  casos_valor int not null default 0,        -- algum dos dois <> 0
  casos_0800 int not null default 0,         -- os dois = 0
  vl_inden numeric(16,2) not null default 0,
  vl_despesas numeric(16,2) not null default 0,
  primary key (mes, seg, ramo, situacao, faixa_valor, produtor)
);

-- Estado de cada mês: fechado (congelado) ou aberto.
create table if not exists corp_retrato_meses (
  assunto text not null check (assunto in ('producao','sinistros')),
  mes date not null,
  congelado boolean not null default false,
  gravado_em timestamptz not null default now(),
  primary key (assunto, mes)
);

-- Diferenças que a fonte trouxe para um mês já congelado (não reescreve o mês).
create table if not exists corp_alteracoes_pos_fechamento (
  id bigint generated always as identity primary key,
  assunto text not null,
  mes date not null,
  detectado_em timestamptz not null default now(),
  arquivo_id text,
  resumo jsonb not null                      -- { congelado: {...}, fonte_atual: {...} }
);
create index if not exists corp_alteracoes_mes_idx on corp_alteracoes_pos_fechamento(assunto, mes);

-- Monta o retrato de produção de UM mês a partir das linhas tratadas.
create or replace function corp_calcular_retrato_producao(p_mes date)
returns setof corp_retrato_producao
language sql stable set search_path = public as $$
  with c as (
    select pc.*, coalesce(d.tipo_doc in ('C','I','M','R','X'), false) as endosso
    from corp_producao_corretora pc left join corp_documentos d using (nosso_numero)
    where pc.ini_vig >= p_mes and pc.ini_vig < (p_mes + interval '1 month')
  ),
  p as (
    select pp.* from corp_producao_produtor pp
    where pp.ini_vig >= p_mes and pp.ini_vig < (p_mes + interval '1 month')
  ),
  e as (
    select g.* from corp_grade g
    where g.ini_vig >= p_mes and g.ini_vig < (p_mes + interval '1 month')
      and g.produtor in ('SEGIMOB','SUPERLOGICA','RETRANSMISSÃO')
      and g.ramo is not null and g.ramo <> 'Ramo'
      and g.classe_corretora is distinct from 'NÃO ENTRA'
  )
  select p_mes, 'corretora'::text, coalesce(ramo,''), coalesce(seg,''), coalesce(produtor,''), coalesce(tipo,''),
         coalesce(cancelado,''), coalesce(faixa_parcelas,''), endosso,
         count(distinct nosso_numero)::int, coalesce(sum(pr_liquido),0), coalesce(sum(pr_total),0),
         coalesce(sum(vl_com),0), 0::numeric,
         coalesce(sum(pct_com) filter (where pct_com > 0),0), (count(*) filter (where pct_com > 0))::int, 0::numeric, 0
  from c group by 3,4,5,6,7,8,9
  union all
  select p_mes, 'produtor', coalesce(ramo,''), coalesce(seg,''), coalesce(produtor,''), coalesce(tipo,''),
         coalesce(cancelado,''), '', false,
         count(distinct nosso_numero)::int, 0, 0, 0, coalesce(sum(vl_com_prod),0),
         0, 0, coalesce(sum(pct_com_prod) filter (where pct_com_prod > 0),0), (count(*) filter (where pct_com_prod > 0))::int
  from p group by 3,4,5,6,7
  union all
  select p_mes, 'excecao', coalesce(ramo,''), coalesce(seg,''), coalesce(produtor,''), '', '', '', false,
         count(distinct nosso_numero)::int, coalesce(sum(pr_liquido),0), 0, coalesce(sum(vl_com),0), 0, 0, 0, 0, 0
  from e group by 3,4,5
$$;

create or replace function corp_calcular_retrato_sinistros(p_mes date)
returns setof corp_retrato_sinistros
language sql stable set search_path = public as $$
  select p_mes, coalesce(seg,''), coalesce(ramo,''), coalesce(situacao,''),
    case when coalesce(vl_inden,0) + coalesce(vl_despesas,0) = 0 then 'SEM VALOR'
         when coalesce(vl_inden,0) + coalesce(vl_despesas,0) < 1000 then 'MENOR QUE 1K'
         when coalesce(vl_inden,0) + coalesce(vl_despesas,0) <= 5000 then 'ENTRE 1K E 5K'
         when coalesce(vl_inden,0) + coalesce(vl_despesas,0) <= 10000 then 'ENTRE 5K E 10K'
         else 'MAIOR QUE 10K' end,
    coalesce(produtor,''),
    count(*)::int,
    (count(*) filter (where coalesce(vl_inden,0) <> 0))::int,
    (count(*) filter (where coalesce(vl_despesas,0) <> 0))::int,
    (count(*) filter (where coalesce(vl_inden,0) <> 0 or coalesce(vl_despesas,0) <> 0))::int,
    (count(*) filter (where coalesce(vl_inden,0) = 0 and coalesce(vl_despesas,0) = 0))::int,
    coalesce(sum(vl_inden),0), coalesce(sum(vl_despesas),0)
  from corp_sinistros
  where nosso_numero is not null and dt_ocor >= p_mes and dt_ocor < (p_mes + interval '1 month')
  group by 2,3,4,5,6
$$;

-- Atualiza os retratos depois de uma importação.
--  * mês aberto (o atual, e o anterior até o dia 15): recalcula;
--  * mês ainda sem retrato: grava e já congela (se não for aberto);
--  * mês congelado: compara com a fonte; se mudou, registra a diferença e NÃO reescreve.
create or replace function corp_atualizar_retratos(p_arquivo_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_atual date := date_trunc('month', v_hoje)::date;
  v_aberto_ate date := case when extract(day from v_hoje) <= 15 then (v_atual - interval '1 month')::date else v_atual end;
  v_mes date;
  v_estado record;
  v_novo jsonb;
  v_velho jsonb;
  v_gravados int := 0;
  v_recalculados int := 0;
  v_alteracoes int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user <> 'postgres' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;

  -- produção
  for v_mes in
    select distinct date_trunc('month', ini_vig)::date from corp_grade where ini_vig is not null
    union select mes from corp_retrato_meses where assunto = 'producao'
    order by 1
  loop
    select * into v_estado from corp_retrato_meses where assunto = 'producao' and mes = v_mes;
    if not found or not v_estado.congelado or v_mes >= v_aberto_ate then
      delete from corp_retrato_producao where mes = v_mes;
      insert into corp_retrato_producao select * from corp_calcular_retrato_producao(v_mes);
      insert into corp_retrato_meses (assunto, mes, congelado, gravado_em)
        values ('producao', v_mes, v_mes < v_aberto_ate, now())
        on conflict (assunto, mes) do update set congelado = excluded.congelado, gravado_em = now();
      if v_estado.mes is null then v_gravados := v_gravados + 1; else v_recalculados := v_recalculados + 1; end if;
    else
      select jsonb_build_object('documentos', coalesce(sum(documentos) filter (where base='corretora'),0),
                                'pr_liquido', coalesce(sum(pr_liquido) filter (where base='corretora'),0),
                                'vl_com', coalesce(sum(vl_com) filter (where base='corretora'),0),
                                'cancelados', coalesce(sum(documentos) filter (where base='corretora' and cancelado='T'),0),
                                'vl_com_prod', coalesce(sum(vl_com_prod) filter (where base='produtor'),0))
        into v_velho from corp_retrato_producao where mes = v_mes;
      select jsonb_build_object('documentos', coalesce(sum(documentos) filter (where base='corretora'),0),
                                'pr_liquido', coalesce(sum(pr_liquido) filter (where base='corretora'),0),
                                'vl_com', coalesce(sum(vl_com) filter (where base='corretora'),0),
                                'cancelados', coalesce(sum(documentos) filter (where base='corretora' and cancelado='T'),0),
                                'vl_com_prod', coalesce(sum(vl_com_prod) filter (where base='produtor'),0))
        into v_novo from corp_calcular_retrato_producao(v_mes);
      if v_novo is distinct from v_velho
         and not exists (select 1 from corp_alteracoes_pos_fechamento a
                         where a.assunto = 'producao' and a.mes = v_mes and a.resumo->'fonte_atual' = v_novo) then
        insert into corp_alteracoes_pos_fechamento (assunto, mes, arquivo_id, resumo)
          values ('producao', v_mes, p_arquivo_id, jsonb_build_object('congelado', v_velho, 'fonte_atual', v_novo));
        v_alteracoes := v_alteracoes + 1;
      end if;
    end if;
    v_estado := null;
  end loop;

  -- sinistros
  for v_mes in
    select distinct date_trunc('month', dt_ocor)::date from corp_sinistros where dt_ocor is not null
    union select mes from corp_retrato_meses where assunto = 'sinistros'
    order by 1
  loop
    select * into v_estado from corp_retrato_meses where assunto = 'sinistros' and mes = v_mes;
    if not found or not v_estado.congelado or v_mes >= v_aberto_ate then
      delete from corp_retrato_sinistros where mes = v_mes;
      insert into corp_retrato_sinistros select * from corp_calcular_retrato_sinistros(v_mes);
      insert into corp_retrato_meses (assunto, mes, congelado, gravado_em)
        values ('sinistros', v_mes, v_mes < v_aberto_ate, now())
        on conflict (assunto, mes) do update set congelado = excluded.congelado, gravado_em = now();
      if v_estado.mes is null then v_gravados := v_gravados + 1; else v_recalculados := v_recalculados + 1; end if;
    else
      select jsonb_build_object('casos', coalesce(sum(casos),0), 'vl_inden', coalesce(sum(vl_inden),0),
                                'vl_despesas', coalesce(sum(vl_despesas),0))
        into v_velho from corp_retrato_sinistros where mes = v_mes;
      select jsonb_build_object('casos', coalesce(sum(casos),0), 'vl_inden', coalesce(sum(vl_inden),0),
                                'vl_despesas', coalesce(sum(vl_despesas),0))
        into v_novo from corp_calcular_retrato_sinistros(v_mes);
      if v_novo is distinct from v_velho
         and not exists (select 1 from corp_alteracoes_pos_fechamento a
                         where a.assunto = 'sinistros' and a.mes = v_mes and a.resumo->'fonte_atual' = v_novo) then
        insert into corp_alteracoes_pos_fechamento (assunto, mes, arquivo_id, resumo)
          values ('sinistros', v_mes, p_arquivo_id, jsonb_build_object('congelado', v_velho, 'fonte_atual', v_novo));
        v_alteracoes := v_alteracoes + 1;
      end if;
    end if;
    v_estado := null;
  end loop;

  return jsonb_build_object('meses_gravados', v_gravados, 'meses_recalculados', v_recalculados,
                            'alteracoes_pos_fechamento', v_alteracoes, 'aberto_desde', v_aberto_ate);
end $$;
revoke all on function corp_atualizar_retratos(text) from public, anon;
grant execute on function corp_atualizar_retratos(text) to authenticated, service_role;

-- ---------- RLS: só colaborador O2 lê; gravação via service_role ----------
do $$
declare t text;
begin
  foreach t in array array['corp_sp_arquivos','corp_grade','corp_sinistros','corp_documentos','corp_regra_produtor',
    'corp_regra_ramo','corp_regra_seguradora','corp_meta_comissao','corp_analise_recusado','corp_cidade_padrao',
    'corp_dominio','corp_retrato_producao','corp_retrato_sinistros','corp_retrato_meses','corp_alteracoes_pos_fechamento']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_o2', t);
    execute format('create policy %I on %I for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2())', t || '_o2', t);
  end loop;
end $$;
