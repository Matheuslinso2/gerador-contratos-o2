-- Dashboard de Sinistros (Fase A do planejamento v2 —
-- entregaveis/modulo-sinistro/Modulo Sinistros - Planejamento v2 (Dashboard e Multiproduto).pdf).
--
-- Qualquer período (mês, semestre, personalizado...) vira soma de MESES. Para
-- isso a base é guardada já mensal:
--   sinistros_kpi_fato           1 linha por sinistro, já com produto, seguradora
--                                (da apólice) e grupo/imobiliária resolvidos;
--   sinistros_kpi_carteira_mes   por produto × grupo/imobiliária × seguradora × mês:
--                                apólices vigentes no fim do mês e prêmio ganho no mês
--                                (pro rata por dia da vigência);
--   sinistros_kpi_grupos         opções do filtro de imobiliária/grupo.
-- Refeita por atualizar_base_kpis_sinistros() (importador do Corp e a própria
-- página quando a base passa de 12 h). Só equipe O2. Aplicado via MCP.

create table if not exists sinistros_kpi_fato (
  id uuid primary key,
  origem text not null,                 -- corp (histórico) | workspace (módulo, Fase B)
  produto text not null,
  nosso_numero text,
  numero_sinistro text,
  seguradora text,
  grupo_chave text,
  tipo_sinistro text,
  situacao text not null,
  dt_aviso date,                        -- aviso; sem ele, a ocorrência
  dt_encerramento date,
  vl_avisado numeric(14,2),
  vl_indenizado numeric(14,2),
  segurado text
);
create index if not exists sinistros_kpi_fato_aviso_idx on sinistros_kpi_fato(dt_aviso);
create index if not exists sinistros_kpi_fato_enc_idx on sinistros_kpi_fato(dt_encerramento);
create index if not exists sinistros_kpi_fato_grupo_idx on sinistros_kpi_fato(grupo_chave);

create table if not exists sinistros_kpi_carteira_mes (
  produto text not null,
  grupo_chave text not null,
  seguradora text not null,
  mes date not null,
  vigentes integer not null,
  premio_ganho numeric(16,2) not null,
  primary key (produto, grupo_chave, seguradora, mes)
);
create index if not exists sinistros_kpi_carteira_mes_mes_idx on sinistros_kpi_carteira_mes(mes);

create table if not exists sinistros_kpi_grupos (
  chave text primary key,
  nome text not null,
  tipo text not null                    -- grupo | imobiliaria | sem_vinculo
);

create table if not exists sinistros_kpi_base_meta (
  id smallint primary key default 1 check (id = 1),
  atualizado_em timestamptz not null default now()
);

alter table sinistros_kpi_fato enable row level security;
alter table sinistros_kpi_carteira_mes enable row level security;
alter table sinistros_kpi_grupos enable row level security;
alter table sinistros_kpi_base_meta enable row level security;
drop policy if exists "sinistros_kpi_fato o2" on sinistros_kpi_fato;
create policy "sinistros_kpi_fato o2" on sinistros_kpi_fato for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistros_kpi_carteira_mes o2" on sinistros_kpi_carteira_mes;
create policy "sinistros_kpi_carteira_mes o2" on sinistros_kpi_carteira_mes for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistros_kpi_grupos o2" on sinistros_kpi_grupos;
create policy "sinistros_kpi_grupos o2" on sinistros_kpi_grupos for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistros_kpi_base_meta o2" on sinistros_kpi_base_meta;
create policy "sinistros_kpi_base_meta o2" on sinistros_kpi_base_meta for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());

create or replace function atualizar_base_kpis_sinistros()
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  agora timestamptz := now();
begin
  -- Equipe O2, ou o próprio servidor (service_role: cron e importador).
  if coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'acesso restrito à equipe O2';
  end if;

  -- Quem é quem: grupo da imobiliária > imobiliária confirmada > texto do Corp.
  drop table if exists tmp_quem;
  create temp table tmp_quem on commit drop as
  with vinc as (
    select distinct on (trim(nome_original)) trim(nome_original) nome, imobiliaria_id
    from imobiliaria_registros_fonte
    where fonte = 'corp_produtor' and situacao = 'confirmado' and imobiliaria_id is not null
    order by trim(nome_original), confirmado_em desc nulls last
  )
  select t.texto,
    coalesce('g:' || g.id::text, 'i:' || i.id::text, 't:' || t.texto) chave,
    coalesce(g.nome, nullif(i.apelido, ''), i.nome, t.texto) nome,
    case when g.id is not null then 'grupo' when i.id is not null then 'imobiliaria' else 'sem_vinculo' end tipo
  from (select distinct trim(imobiliaria_texto) texto from producao_unificada where fonte = 'corp' and imobiliaria_texto is not null) t
  left join vinc v on v.nome = t.texto
  left join imobiliarias i on i.id = v.imobiliaria_id
  left join imobiliaria_grupos g on g.id = i.grupo_id;
  create index on tmp_quem(texto);

  delete from sinistros_kpi_grupos;
  insert into sinistros_kpi_grupos (chave, nome, tipo)
  select distinct on (chave) chave, nome, tipo from tmp_quem order by chave;

  delete from sinistros_kpi_fato;
  insert into sinistros_kpi_fato (id, origem, produto, nosso_numero, numero_sinistro, seguradora, grupo_chave,
    tipo_sinistro, situacao, dt_aviso, dt_encerramento, vl_avisado, vl_indenizado, segurado)
  select sc.id, 'corp', 'fianca', sc.nosso_numero, sc.numero_sinistro, coalesce(ap.seguradora, sc.seguradora), q.chave,
    sc.tipo_sinistro, sc.situacao, coalesce(sc.dt_aviso, sc.dt_ocorrencia), sc.dt_encerramento,
    sc.vl_avisado, sc.vl_indenizado, sc.segurado
  from sinistros_corp sc
  left join (
    select distinct on (origem_corp_numero) origem_corp_numero nn, trim(imobiliaria_texto) texto, seguradora
    from producao_unificada where produto = 'fianca' and fonte = 'corp'
    order by origem_corp_numero, data_efetivacao desc nulls last
  ) ap on ap.nn = sc.nosso_numero
  left join tmp_quem q on q.texto = ap.texto;

  -- Carteira mês a mês (desde 2019): vigente no último dia do mês (ou hoje,
  -- no mês corrente) e prêmio ganho = prêmio × dias de vigência dentro do mês
  -- (até hoje) ÷ dias totais da vigência. As apólices vão antes para uma tabela
  -- estreita: ordenar a linha inteira (com extras) custava ~10 s.
  drop table if exists tmp_ap;
  create temp table tmp_ap on commit drop as
  select p.produto, q.chave, coalesce(p.seguradora, '—') seguradora, coalesce(p.premio, 0) premio,
    (p.extras ->> 'vigencia_inicio')::date vi, (p.extras ->> 'vigencia_fim')::date vf
  from producao_unificada p
  join tmp_quem q on q.texto = trim(p.imobiliaria_texto)
  where p.fonte = 'corp' and p.produto = 'fianca'
    and (p.extras ->> 'vigencia_inicio') is not null and (p.extras ->> 'vigencia_fim') is not null;
  delete from tmp_ap where vf < vi or vf < date '2019-01-01';

  drop table if exists tmp_meses;
  create temp table tmp_meses on commit drop as
  select m::date ini, least((m + interval '1 month - 1 day')::date, current_date) fim
  from generate_series(date '2019-01-01', date_trunc('month', current_date), interval '1 month') m;

  delete from sinistros_kpi_carteira_mes;
  insert into sinistros_kpi_carteira_mes (produto, grupo_chave, seguradora, mes, vigentes, premio_ganho)
  select a.produto, a.chave, a.seguradora, me.ini,
    count(*) filter (where a.vi <= me.fim and a.vf >= me.fim),
    coalesce(sum(case when a.premio > 0 then
      a.premio * greatest(0, least(a.vf, me.fim) - greatest(a.vi, me.ini) + 1)::numeric / greatest(a.vf - a.vi + 1, 1)
    end), 0)
  from tmp_ap a
  join tmp_meses me on me.ini <= a.vf and me.fim >= a.vi
  group by 1, 2, 3, 4;

  insert into sinistros_kpi_base_meta (id, atualizado_em) values (1, agora)
  on conflict (id) do update set atualizado_em = excluded.atualizado_em;
  return agora;
end;
$$;

revoke execute on function atualizar_base_kpis_sinistros() from anon, public;
grant execute on function atualizar_base_kpis_sinistros() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cálculo do dashboard. Período = meses de p_inicio a p_fim (1º dia de cada
-- mês); o mês corrente vale até hoje. Filtros opcionais: seguradoras,
-- grupo/imobiliária (chave de sinistros_kpi_grupos), tipos, situações
-- ('em_aberto' | 'indenizado' | 'sem_indenizacao').
-- Regras (planejamento v2, seção 4): cada evento no mês em que aconteceu; em
-- aberto = foto no último dia; sinistralidade = indenizado ÷ prêmio ganho no
-- período; frequência = avisados ÷ média de vigentes (e anualizada na tela).

create or replace function kpis_sinistros_bloco(
  p_ini date, p_fim date, p_segs text[], p_grupo text, p_tipos text[], p_sits text[]
) returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  with lim as (
    select p_ini ini, least((p_fim + interval '1 month - 1 day')::date, current_date) fim_dia,
      (extract(year from age(p_fim, p_ini)) * 12 + extract(month from age(p_fim, p_ini)) + 1)::int meses
  ),
  f as (
    select f.*,
      case when f.situacao in ('PENDENTE', 'EM ANDAMENTO') then 'em_aberto'
           when f.situacao = 'INDENIZADO' then 'indenizado' else 'sem_indenizacao' end sit
    from sinistros_kpi_fato f
    where (p_segs is null or f.seguradora = any(p_segs))
      and (p_grupo is null or f.grupo_chave = p_grupo)
      and (p_tipos is null or coalesce(f.tipo_sinistro, 'nao_informado') = any(p_tipos))
  ),
  fs as (select * from f where p_sits is null or sit = any(p_sits)),
  c as (
    select cm.mes, sum(cm.vigentes) vigentes, sum(cm.premio_ganho) premio_ganho
    from sinistros_kpi_carteira_mes cm
    where cm.mes between p_ini and p_fim
      and (p_segs is null or cm.seguradora = any(p_segs))
      and (p_grupo is null or cm.grupo_chave = p_grupo)
    group by cm.mes
  ),
  rec as (
    select f.nosso_numero, count(*) n from f, lim
    where f.dt_aviso > lim.fim_dia - interval '24 months' and f.dt_aviso <= lim.fim_dia
    group by 1
  )
  select jsonb_build_object(
    'meses', lim.meses,
    'avisados', count(fs.id) filter (where fs.dt_aviso between lim.ini and lim.fim_dia),
    'avisados_ocupado', count(fs.id) filter (where fs.dt_aviso between lim.ini and lim.fim_dia and fs.tipo_sinistro = 'ocupado'),
    'avisados_chaves', count(fs.id) filter (where fs.dt_aviso between lim.ini and lim.fim_dia and fs.tipo_sinistro = 'chaves'),
    'avisado_valor', round(coalesce(sum(fs.vl_avisado) filter (where fs.dt_aviso between lim.ini and lim.fim_dia), 0)),
    'encerrados_indenizados', count(fs.id) filter (where fs.sit = 'indenizado' and fs.dt_encerramento between lim.ini and lim.fim_dia),
    'encerrados_sem_indenizacao', count(fs.id) filter (where fs.sit = 'sem_indenizacao' and fs.dt_encerramento between lim.ini and lim.fim_dia),
    'indenizado', round(coalesce(sum(fs.vl_indenizado) filter (where fs.sit = 'indenizado' and fs.dt_encerramento between lim.ini and lim.fim_dia), 0)),
    'ticket_medio', round(coalesce(avg(fs.vl_indenizado) filter (where fs.sit = 'indenizado' and fs.vl_indenizado > 0 and fs.dt_encerramento between lim.ini and lim.fim_dia), 0)),
    'em_aberto_fim', count(fs.id) filter (where fs.dt_aviso <= lim.fim_dia
        and (fs.dt_encerramento > lim.fim_dia or (fs.dt_encerramento is null and fs.sit = 'em_aberto'))),
    'em_aberto_90', count(fs.id) filter (where fs.dt_aviso <= lim.fim_dia - 90
        and (fs.dt_encerramento > lim.fim_dia or (fs.dt_encerramento is null and fs.sit = 'em_aberto'))),
    'mediana_dias_ate_encerrar', percentile_cont(0.5) within group (order by fs.dt_encerramento - fs.dt_aviso)
        filter (where fs.sit <> 'em_aberto' and fs.dt_encerramento between lim.ini and lim.fim_dia and fs.dt_encerramento >= fs.dt_aviso),
    'vigentes_media', (select round(avg(c.vigentes)) from c),
    'vigentes_fim', (select c.vigentes from c order by c.mes desc limit 1),
    'premio_ganho', (select round(sum(c.premio_ganho)) from c),
    'contratos_24m', (select count(*) from rec),
    'recorrentes_24m', (select count(*) from rec where rec.n > 1)
  )
  from lim left join fs on true
  group by lim.ini, lim.fim_dia, lim.meses;
$$;

create or replace function kpis_sinistros_dashboard(
  p_inicio date, p_fim date,
  p_seguradoras text[] default null, p_grupo text default null,
  p_tipos text[] default null, p_situacoes text[] default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  n int := (extract(year from age(p_fim, p_inicio)) * 12 + extract(month from age(p_fim, p_inicio)) + 1)::int;
  fim_dia date := least((p_fim + interval '1 month - 1 day')::date, current_date);
  r jsonb;
begin
  if not is_colaborador_o2() then
    raise exception 'acesso restrito à equipe O2';
  end if;

  with
  f as (
    select f.*,
      case when f.situacao in ('PENDENTE', 'EM ANDAMENTO') then 'em_aberto'
           when f.situacao = 'INDENIZADO' then 'indenizado' else 'sem_indenizacao' end sit
    from sinistros_kpi_fato f
    where (p_seguradoras is null or f.seguradora = any(p_seguradoras))
      and (p_grupo is null or f.grupo_chave = p_grupo)
      and (p_tipos is null or coalesce(f.tipo_sinistro, 'nao_informado') = any(p_tipos))
      and (p_situacoes is null or (case when f.situacao in ('PENDENTE', 'EM ANDAMENTO') then 'em_aberto'
           when f.situacao = 'INDENIZADO' then 'indenizado' else 'sem_indenizacao' end) = any(p_situacoes))
  ),
  c as (
    select cm.* from sinistros_kpi_carteira_mes cm
    where cm.mes between p_inicio and p_fim
      and (p_seguradoras is null or cm.seguradora = any(p_seguradoras))
      and (p_grupo is null or cm.grupo_chave = p_grupo)
  ),
  aberto as (
    select * from f where f.dt_aviso <= fim_dia and (f.dt_encerramento > fim_dia or (f.dt_encerramento is null and f.sit = 'em_aberto'))
  ),
  meses as (select generate_series(p_inicio, p_fim, interval '1 month')::date mes),
  av_mes as (select date_trunc('month', f.dt_aviso)::date mes, count(*) n from f group by 1),
  enc_mes as (
    select date_trunc('month', f.dt_encerramento)::date mes,
      count(*) filter (where f.sit = 'indenizado') ind,
      count(*) filter (where f.sit = 'sem_indenizacao') sem,
      sum(f.vl_indenizado) filter (where f.sit = 'indenizado') valor
    from f group by 1
  ),
  cart_mes as (select c.mes, sum(c.vigentes) vig, sum(c.premio_ganho) pg from c group by 1),
  mensal as (
    select jsonb_agg(jsonb_build_object(
      'mes', to_char(m.mes, 'YYYY-MM'),
      'avisados', coalesce(av_mes.n, 0),
      'indenizados', coalesce(enc_mes.ind, 0),
      'sem_indenizacao', coalesce(enc_mes.sem, 0),
      'valor_indenizado', round(coalesce(enc_mes.valor, 0)),
      'vigentes', coalesce(cart_mes.vig, 0),
      'premio_ganho', round(coalesce(cart_mes.pg, 0))
    ) order by m.mes) j
    from meses m
    left join av_mes on av_mes.mes = m.mes
    left join enc_mes on enc_mes.mes = m.mes
    left join cart_mes on cart_mes.mes = m.mes
  ),
  seg_f as (
    select f.seguradora seg,
      count(*) filter (where f.dt_aviso between p_inicio and fim_dia) avisados,
      count(*) filter (where f.sit = 'indenizado' and f.dt_encerramento between p_inicio and fim_dia) indenizados,
      count(*) filter (where f.sit = 'sem_indenizacao' and f.dt_encerramento between p_inicio and fim_dia) sem_indenizacao,
      round(coalesce(sum(f.vl_indenizado) filter (where f.sit = 'indenizado' and f.dt_encerramento between p_inicio and fim_dia), 0)) indenizado,
      count(*) filter (where f.dt_aviso <= fim_dia and (f.dt_encerramento > fim_dia or (f.dt_encerramento is null and f.sit = 'em_aberto'))) em_aberto
    from f where f.seguradora is not null group by 1
  ),
  seg_c as (select c.seguradora seg, round(sum(c.vigentes)::numeric / n) vigentes_media, round(sum(c.premio_ganho)) premio_ganho from c group by 1),
  quebra_seg as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'seguradora', coalesce(sf.seg, sc.seg),
      'avisados', coalesce(sf.avisados, 0), 'indenizados', coalesce(sf.indenizados, 0),
      'sem_indenizacao', coalesce(sf.sem_indenizacao, 0), 'indenizado', coalesce(sf.indenizado, 0),
      'em_aberto', coalesce(sf.em_aberto, 0),
      'vigentes_media', sc.vigentes_media, 'premio_ganho', sc.premio_ganho
    ) order by coalesce(sf.indenizado, 0) desc, coalesce(sf.avisados, 0) desc), '[]'::jsonb) j
    from seg_f sf full join seg_c sc on sc.seg = sf.seg
    where coalesce(sf.avisados, 0) + coalesce(sf.indenizados, 0) + coalesce(sf.sem_indenizacao, 0) + coalesce(sf.em_aberto, 0) > 0
  ),
  quebra_tipo as (
    select coalesce(jsonb_agg(jsonb_build_object('tipo', t.tipo, 'avisados', t.avisados, 'indenizado', t.indenizado) order by t.avisados desc), '[]'::jsonb) j from (
      select coalesce(f.tipo_sinistro, 'nao_informado') tipo,
        count(*) filter (where f.dt_aviso between p_inicio and fim_dia) avisados,
        round(coalesce(sum(f.vl_indenizado) filter (where f.sit = 'indenizado' and f.dt_encerramento between p_inicio and fim_dia), 0)) indenizado
      from f group by 1
    ) t where t.avisados > 0 or t.indenizado > 0
  ),
  rank_f as (
    select f.grupo_chave chave,
      count(*) filter (where f.dt_aviso between p_inicio and fim_dia) avisados,
      count(*) filter (where f.sit = 'indenizado' and f.dt_encerramento between p_inicio and fim_dia) indenizados,
      round(coalesce(sum(f.vl_indenizado) filter (where f.sit = 'indenizado' and f.dt_encerramento between p_inicio and fim_dia), 0)) indenizado,
      count(*) filter (where f.dt_aviso <= fim_dia and (f.dt_encerramento > fim_dia or (f.dt_encerramento is null and f.sit = 'em_aberto'))) em_aberto
    from f where p_grupo is null and f.grupo_chave is not null group by 1
  ),
  rank_c as (select c.grupo_chave chave, round(sum(c.vigentes)::numeric / n) vigentes_media, round(sum(c.premio_ganho)) premio_ganho from c where p_grupo is null group by 1),
  ranking as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'chave', rf.chave, 'nome', g.nome, 'tipo', g.tipo,
      'avisados', rf.avisados, 'indenizados', rf.indenizados, 'indenizado', rf.indenizado, 'em_aberto', rf.em_aberto,
      'vigentes_media', rc.vigentes_media, 'premio_ganho', rc.premio_ganho
    ) order by rf.indenizado desc, rf.avisados desc), '[]'::jsonb) j
    from rank_f rf
    join sinistros_kpi_grupos g on g.chave = rf.chave
    left join rank_c rc on rc.chave = rf.chave
    where rf.avisados > 0 or rf.indenizado > 0 or rf.em_aberto > 0
  ),
  lista as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'segurado', l.segurado, 'seguradora', l.seguradora, 'numero_sinistro', l.numero_sinistro, 'tipo', l.tipo_sinistro,
      'situacao', l.situacao, 'dt_aviso', l.dt_aviso, 'dt_encerramento', l.dt_encerramento,
      'vl_avisado', l.vl_avisado, 'vl_indenizado', l.vl_indenizado
    ) order by l.dt_aviso desc), '[]'::jsonb) j
    from (select * from f where p_grupo is not null
            and (f.dt_aviso between p_inicio and fim_dia or f.dt_encerramento between p_inicio and fim_dia
                 or (f.dt_aviso <= fim_dia and (f.dt_encerramento > fim_dia or (f.dt_encerramento is null and f.sit = 'em_aberto'))))) l
  ),
  mods as (
    select m.* from sinistros m
    left join imobiliarias i on i.id = m.imobiliaria_id
    where m.enviado_em is not null and m.etapa <> 'cancelado'
      and m.enviado_em::date between p_inicio and fim_dia
      and (p_grupo is null or p_grupo = coalesce('g:' || i.grupo_id::text, 'i:' || i.id::text))
  ),
  processo as (
    select jsonb_build_object(
      'enviados', (select count(*) from mods),
      'no_prazo', (select count(*) from mods where not mods.aviso_fora_prazo),
      'com_pendencia', (select count(distinct h.sinistro_id) from sinistro_historico h join mods on mods.id = h.sinistro_id where h.etapa_para = 'pendencia_imobiliaria'),
      'abertos_na_seguradora', (select count(*) from mods where mods.numero_sinistro_seguradora is not null),
      'mediana_dias_ate_abrir', (select percentile_cont(0.5) within group (order by mods.data_abertura_seguradora - mods.enviado_em::date) from mods where mods.data_abertura_seguradora is not null)
    ) j
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'fim_dia', fim_dia, 'meses', n,
                                  'parcial', p_fim >= date_trunc('month', current_date)::date),
    'base_atualizada_em', (select atualizado_em from sinistros_kpi_base_meta where id = 1),
    'grupo', (select jsonb_build_object('chave', g.chave, 'nome', g.nome, 'tipo', g.tipo) from sinistros_kpi_grupos g where g.chave = p_grupo),
    'resumo', kpis_sinistros_bloco(p_inicio, p_fim, p_seguradoras, p_grupo, p_tipos, p_situacoes),
    'anterior', kpis_sinistros_bloco((p_inicio - make_interval(months => n))::date, (p_fim - make_interval(months => n))::date, p_seguradoras, p_grupo, p_tipos, p_situacoes),
    'ano_anterior', kpis_sinistros_bloco((p_inicio - interval '12 months')::date, (p_fim - interval '12 months')::date, p_seguradoras, p_grupo, p_tipos, p_situacoes),
    'carteira', case when p_grupo is not null then kpis_sinistros_bloco(p_inicio, p_fim, p_seguradoras, null, p_tipos, p_situacoes) end,
    'mensal', (select j from mensal),
    'por_seguradora', (select j from quebra_seg),
    'por_tipo', (select j from quebra_tipo),
    'ranking', (select j from ranking),
    'sinistros', (select j from lista),
    'processo', (select j from processo),
    'opcoes_seguradoras', (select coalesce(jsonb_agg(x.s order by x.s), '[]'::jsonb) from (
        select distinct cm.seguradora s from sinistros_kpi_carteira_mes cm where cm.vigentes > 0 and cm.seguradora <> '—'
        union select distinct sf.seguradora from sinistros_kpi_fato sf where sf.seguradora is not null) x)
  ) into r;
  return r;
end;
$$;

-- Lista do filtro de imobiliária/grupo (só quem tem carteira ou sinistro).
create or replace function opcoes_grupos_sinistros()
returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select case when not is_colaborador_o2() then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object('chave', g.chave, 'nome', g.nome, 'tipo', g.tipo) order by g.nome), '[]'::jsonb) end
  from sinistros_kpi_grupos g
  where exists (select 1 from sinistros_kpi_fato f where f.grupo_chave = g.chave)
     or exists (select 1 from sinistros_kpi_carteira_mes c where c.grupo_chave = g.chave and c.vigentes > 0);
$$;

revoke execute on function kpis_sinistros_bloco(date, date, text[], text, text[], text[]) from anon, public, authenticated;
revoke execute on function kpis_sinistros_dashboard(date, date, text[], text, text[], text[]) from anon, public;
grant execute on function kpis_sinistros_dashboard(date, date, text[], text, text[], text[]) to authenticated;
revoke execute on function opcoes_grupos_sinistros() from anon, public;
grant execute on function opcoes_grupos_sinistros() to authenticated;
