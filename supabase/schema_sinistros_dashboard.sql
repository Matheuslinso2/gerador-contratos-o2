-- Dashboard de Sinistros (Fase A do planejamento v2 —
-- entregaveis/modulo-sinistro/Modulo Sinistros - Planejamento v2 (Dashboard e Multiproduto).pdf).
--
-- Qualquer período (mês, semestre, personalizado...) vira soma de MESES. Para
-- isso a base é guardada já mensal:
--   sinistros_kpi_fato           1 linha por sinistro, já com produto, seguradora
--                                (da apólice) e grupo/imobiliária resolvidos;
--   sinistros_kpi_carteira_mes   por produto × produtor do Corp × seguradora × mês (mês fechado congela):
--                                apólices vigentes no fim do mês e prêmio ganho no mês
--                                (pro rata por dia da vigência);
--   sinistros_kpi_grupos         opções do filtro de imobiliária/grupo.
-- Refeita por atualizar_base_kpis_sinistros() (importador do Corp, cron da
-- madrugada e o botão "Atualizar base"; ~15 s, só o mês aberto -- a
-- reconstrução completa leva ~45 s, por isso service_role tem
-- statement_timeout de 120 s). Fase B (20/10/2026): todos os ramos do Corp --
-- produto = chave de produto_sinistro_de_ramo(). Só equipe O2. Aplicado via MCP.
-- 21/10/2026: imobiliária de cada sinistro do Corp pelo CÓDIGO do produtor da
-- apólice (grade do espelho do SharePoint), como a produção e a Imobiliária
-- 360; o texto do produtor do relatório PDF (cortado) fica só como fallback.

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
  imob_texto text not null,             -- texto do produtor no Corp (imutável)
  grupo_chave text not null,            -- derivado de sinistros_kpi_vinculo
  seguradora text not null,
  mes date not null,
  vigentes integer not null,
  premio_ganho numeric(16,2) not null,
  primary key (produto, imob_texto, seguradora, mes)
);
create index if not exists sinistros_kpi_carteira_mes_mes_idx on sinistros_kpi_carteira_mes(mes);
create index if not exists sinistros_kpi_carteira_mes_texto_idx on sinistros_kpi_carteira_mes(imob_texto);
create index if not exists sinistros_kpi_carteira_mes_grupo_idx on sinistros_kpi_carteira_mes(grupo_chave);

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

-- Produto do painel a partir do ramo padronizado da produção
-- (producao_unificada.ramo_padrao); mesmas chaves do importador do Corp e de
-- src/lib/sinistros/produtos.ts.
create or replace function produto_sinistro_de_ramo(p_produto text, p_ramo text)
returns text language sql immutable as $$
  select case
    when p_produto = 'fianca' then 'fianca'
    when p_produto = 'capitalizacao' then 'capitalizacao'
    when p_produto = 'automovel' then 'automovel'
    when p_ramo = 'Incêndio Imobiliário' then 'incendio'
    -- "Conteúdo" não é produto: é cobertura dentro de Residencial/Incêndio (21/10/2026).
    when p_ramo in ('Residencial', 'Conteúdo residencial/comercial') then 'residencial'
    when p_ramo = 'Condomínio' then 'condominio'
    when p_ramo = 'Empresarial' then 'empresarial'
    when p_ramo = 'Vida' then 'vida'
    when p_ramo = 'Equipamentos portáteis' then 'portateis'
    when p_ramo = 'RC' then 'rc'
    when p_ramo = 'Viagem' then 'viagem'
    else 'outros' end
$$;

-- Jobs do servidor (cron, importador, botão "Atualizar base") rodam como
-- service_role; sem isso herdam os 8 s do authenticator. Usuários seguem com 8 s.
alter role service_role set statement_timeout = '120s';
notify pgrst, 'reload config';

-- Os DELETE levam "where true": pela API o Supabase (safeupdate) recusa
-- DELETE sem WHERE.
--
-- MÊS FECHADO CONGELA (regra do Matheus, 20/10/2026): a carteira de cada mês é
-- gravada uma vez e não é recalculada; a atualização de rotina refaz só o mês
-- atual (e o anterior até o dia 15, para lançamentos atrasados no Corp),
-- lendo só as apólices com fim de vigência no período (índice abaixo). O
-- retrato guarda o texto do produtor do Corp (imutável); o vínculo com
-- imobiliária/grupo fica em sinistros_kpi_vinculo e só é reapontado.
-- Reconstrução completa (só se a regra de cálculo mudar), pelo SQL Editor:
--   select calcular_carteira_sinistros('2019-01-01');

create index if not exists producao_unificada_corp_vig_fim_idx
  on producao_unificada ((extras ->> 'vigencia_fim')) where fonte = 'corp';
-- Vínculo por código do produtor (21/10/2026): índices que cobrem as leituras
-- de producao_unificada (texto do PDF x apólice) e de corp_grade (apólice x
-- código; só leitura do espelho do SharePoint), sem varrer as tabelas.
create index if not exists producao_unificada_corp_texto_idx
  on producao_unificada (origem_corp_numero, imobiliaria_texto) where fonte = 'corp';
create index if not exists corp_grade_apolice_produtor_idx
  on corp_grade (nosso_numero, incluir_corretora desc, id) include (codigo_produtor) where codigo_produtor is not null;

create table if not exists sinistros_kpi_vinculo (
  texto text primary key,               -- texto do produtor no Corp
  chave text not null                   -- g:<grupo> | i:<imobiliária> | t:<texto>
);
alter table sinistros_kpi_vinculo enable row level security;
drop policy if exists "sinistros_kpi_vinculo o2" on sinistros_kpi_vinculo;
create policy "sinistros_kpi_vinculo o2" on sinistros_kpi_vinculo for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());

create or replace function calcular_carteira_sinistros(p_ini date)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  n integer;
begin
  drop table if exists tmp_ap;
  create temp table tmp_ap on commit drop as
  select produto_sinistro_de_ramo(p.produto, p.ramo_padrao) produto, trim(p.imobiliaria_texto) texto,
    coalesce(p.seguradora, '—') seguradora, coalesce(p.premio, 0) premio,
    (p.extras ->> 'vigencia_inicio')::date vi, (p.extras ->> 'vigencia_fim')::date vf
  from producao_unificada p
  where p.fonte = 'corp' and (p.extras ->> 'vigencia_fim') >= p_ini::text
    and (p.extras ->> 'vigencia_inicio') is not null and p.imobiliaria_texto is not null;
  delete from tmp_ap where vf < vi or vi > current_date;

  -- Vigente no último dia do mês (ou hoje) e prêmio ganho = prêmio × dias de
  -- vigência dentro do mês (até hoje) ÷ dias totais da vigência.
  delete from sinistros_kpi_carteira_mes where mes >= p_ini;
  insert into sinistros_kpi_carteira_mes (produto, imob_texto, grupo_chave, seguradora, mes, vigentes, premio_ganho)
  select a.produto, a.texto, 't:' || a.texto, a.seguradora, me.ini,
    count(*) filter (where a.vi <= me.fim and a.vf >= me.fim),
    coalesce(sum(case when a.premio > 0 then
      a.premio * greatest(0, least(a.vf, me.fim) - greatest(a.vi, me.ini) + 1)::numeric / greatest(a.vf - a.vi + 1, 1)
    end), 0)
  from tmp_ap a
  join (
    select m::date ini, least((m + interval '1 month - 1 day')::date, current_date) fim
    from generate_series(greatest(p_ini, date '2019-01-01'), date_trunc('month', current_date), interval '1 month') m
  ) me on me.ini <= a.vf and me.fim >= a.vi
  group by 1, 2, 3, 4, 5;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function calcular_carteira_sinistros(date) from anon, public, authenticated;

-- Ficha da apólice do Corp pelo CÓDIGO do produtor (21/10/2026, mesma regra
-- da produção e da Imobiliária 360): Nosso Nº -> grade do espelho do
-- SharePoint (corp_grade, só leitura; vale a linha que conta para a
-- corretora) -> código -> vínculo confirmado em imobiliaria_registros_fonte
-- (chave_externa = "código#nome"). Sem código ou sem vínculo: nulo, e quem
-- chama cai no texto do produtor do relatório PDF (que vem cortado, ex.
-- "WALKER CORR. E ADM DE COND").
create or replace function imobiliaria_por_apolice_corp(p_nosso_numero text)
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  with g as (
    select x.codigo_produtor::text codigo from corp_grade x
    where p_nosso_numero ~ '^\d{1,18}$' and x.nosso_numero = p_nosso_numero::bigint and x.codigo_produtor is not null
    order by x.incluir_corretora desc, x.id limit 1
  )
  select r.imobiliaria_id
  from g join imobiliaria_registros_fonte r
    on r.fonte = 'corp_produtor' and r.situacao = 'confirmado' and r.imobiliaria_id is not null
   and split_part(r.chave_externa, '#', 1) = g.codigo
  order by r.confirmado_em desc nulls last limit 1
$$;
revoke execute on function imobiliaria_por_apolice_corp(text) from anon, public, authenticated;

create or replace function atualizar_base_kpis_sinistros()
returns timestamptz
language plpgsql security definer set search_path to 'public'
as $$
declare
  agora timestamptz := now();
  desde date := case when extract(day from current_date) <= 15
                     then (date_trunc('month', current_date) - interval '1 month')::date
                     else date_trunc('month', current_date)::date end;
begin
  -- Equipe O2, ou o próprio servidor (service_role: cron e importador).
  if coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'acesso restrito à equipe O2';
  end if;

  perform calcular_carteira_sinistros(desde);

  -- Sinistros (tabelas pequenas). Cada sinistro conta uma vez (21/10/2026):
  --   * histórico do Corp SEM card no Workspace (encerrados e zerados);
  --   * todo card do Workspace (abertos pelo módulo e os trazidos do Corp) --
  --     a gestão é feita aqui, então o card manda.
  -- Zerado (baixado_em) não é encerramento: situação BAIXADO, sem data de
  -- encerramento -> não entra em "em aberto" nem em encerrados de mês nenhum.
  -- Imobiliária do Corp pela apólice: CÓDIGO do produtor na grade do espelho
  -- (imobiliaria_por_apolice_corp) > texto do produtor do relatório PDF
  -- (reapontado pelo vínculo abaixo). Seguradora pela apólice do PDF.
  delete from sinistros_kpi_fato where true;
  insert into sinistros_kpi_fato (id, origem, produto, nosso_numero, numero_sinistro, seguradora, grupo_chave,
    tipo_sinistro, situacao, dt_aviso, dt_encerramento, vl_avisado, vl_indenizado, segurado)
  select sc.id, 'corp', coalesce(sc.produto, 'fianca'), sc.nosso_numero, sc.numero_sinistro, coalesce(ap.seguradora, sc.seguradora),
    coalesce('g:' || ic.grupo_id::text, 'i:' || ic.id::text, case when ap.texto is not null then 't:' || ap.texto end),
    coalesce(sc.tipo_sinistro, sc.subtipo), case when sc.baixado_em is not null then 'BAIXADO' else sc.situacao end,
    coalesce(sc.dt_aviso, sc.dt_ocorrencia), case when sc.baixado_em is null then sc.dt_encerramento end,
    sc.vl_avisado, sc.vl_indenizado, sc.segurado
  from sinistros_corp sc
  left join imobiliarias ic on ic.id = imobiliaria_por_apolice_corp(sc.nosso_numero)
  left join lateral (
    select trim(p.imobiliaria_texto) texto, p.seguradora
    from producao_unificada p
    where p.fonte = 'corp' and p.origem_corp_numero = sc.nosso_numero
      and p.produto = case when coalesce(sc.produto, 'fianca') in ('fianca', 'capitalizacao', 'automovel') then coalesce(sc.produto, 'fianca') else 're' end
    limit 1
  ) ap on true
  where not exists (select 1 from sinistros s where s.sinistro_corp_id = sc.id);

  -- Cards do Workspace: mesma rotina do gatilho (fica depois do vínculo, abaixo).

  -- Vínculo texto -> imobiliária/grupo (carteira e sinistros sem código):
  -- grupo da imobiliária > imobiliária > texto do Corp. A imobiliária do texto
  -- vem (1) pelo CÓDIGO do produtor das apólices que o PDF dá a esse texto
  -- (a ficha mais frequente; empate: a que tem o mesmo nome), (2) pelo nome
  -- confirmado igual ao texto. Só os textos que aparecem na base.
  delete from sinistros_kpi_vinculo where true;
  insert into sinistros_kpi_vinculo (texto, chave)
  with textos as (
    select distinct imob_texto texto from sinistros_kpi_carteira_mes
    union select distinct substr(grupo_chave, 3) from sinistros_kpi_fato where grupo_chave like 't:%'
  ),
  vinc as (
    select distinct on (trim(nome_original)) trim(nome_original) nome, imobiliaria_id
    from imobiliaria_registros_fonte
    where fonte = 'corp_produtor' and situacao = 'confirmado' and imobiliaria_id is not null
    order by trim(nome_original), confirmado_em desc nulls last
  ),
  grade_apolice as (
    select distinct on (x.nosso_numero) x.nosso_numero, x.codigo_produtor::text codigo
    from corp_grade x where x.codigo_produtor is not null
    order by x.nosso_numero, x.incluir_corretora desc, x.id
  ),
  codigo_imob as (
    select distinct on (split_part(r.chave_externa, '#', 1)) split_part(r.chave_externa, '#', 1) codigo, r.imobiliaria_id
    from imobiliaria_registros_fonte r
    where r.fonte = 'corp_produtor' and r.situacao = 'confirmado' and r.imobiliaria_id is not null
    order by split_part(r.chave_externa, '#', 1), r.confirmado_em desc nulls last
  ),
  por_codigo as (
    select distinct on (q.texto) q.texto, q.imobiliaria_id
    from (
      select trim(p.imobiliaria_texto) texto, k.imobiliaria_id, count(*) n
      from producao_unificada p
      join grade_apolice g on p.origem_corp_numero ~ '^\d{1,18}$' and g.nosso_numero = p.origem_corp_numero::bigint
      join codigo_imob k on k.codigo = g.codigo
      where p.fonte = 'corp' and trim(p.imobiliaria_texto) in (select texto from textos)
      group by 1, 2
    ) q
    left join vinc v on v.nome = q.texto
    order by q.texto, q.n desc, (q.imobiliaria_id = v.imobiliaria_id) desc nulls last, q.imobiliaria_id
  )
  select t.texto, coalesce('g:' || i.grupo_id::text, 'i:' || i.id::text, 't:' || t.texto)
  from textos t
  left join por_codigo c on c.texto = t.texto
  left join vinc v on v.nome = t.texto
  left join imobiliarias i on i.id = coalesce(c.imobiliaria_id, v.imobiliaria_id);

  delete from sinistros_kpi_grupos where true;
  insert into sinistros_kpi_grupos (chave, nome, tipo)
  select distinct on (vi.chave) vi.chave,
    coalesce(g.nome, nullif(i.apelido, ''), i.nome, vi.texto),
    case when g.id is not null then 'grupo' when i.id is not null then 'imobiliaria' else 'sem_vinculo' end
  from sinistros_kpi_vinculo vi
  left join imobiliarias i on vi.chave = 'i:' || i.id::text
  left join imobiliaria_grupos g on vi.chave = 'g:' || g.id::text
  order by vi.chave;
  -- Imobiliária/grupo de card do Workspace que não aparece na carteira do Corp.
  insert into sinistros_kpi_grupos (chave, nome, tipo)
  select distinct on (f.grupo_chave) f.grupo_chave, coalesce(g.nome, nullif(i.apelido, ''), i.nome, f.grupo_chave),
    case when g.id is not null then 'grupo' else 'imobiliaria' end
  from sinistros_kpi_fato f
  left join imobiliarias i on f.grupo_chave = 'i:' || i.id::text
  left join imobiliaria_grupos g on f.grupo_chave = 'g:' || g.id::text
  where f.grupo_chave ~ '^[ig]:' and not exists (select 1 from sinistros_kpi_grupos k where k.chave = f.grupo_chave)
  order by f.grupo_chave;

  perform sinistros_kpi_fato_cards();

  -- Reaponta só o que mudou de vínculo (meses fechados não são recalculados).
  update sinistros_kpi_carteira_mes c set grupo_chave = vi.chave
  from sinistros_kpi_vinculo vi
  where vi.texto = c.imob_texto and c.grupo_chave is distinct from vi.chave;
  update sinistros_kpi_fato f set grupo_chave = vi.chave
  from sinistros_kpi_vinculo vi
  where f.grupo_chave = 't:' || vi.texto and vi.chave <> f.grupo_chave;

  insert into sinistros_kpi_base_meta (id, atualizado_em) values (1, agora)
  on conflict (id) do update set atualizado_em = excluded.atualizado_em;
  return agora;
end;
$$;

-- Parte do dashboard que vem dos cards do Workspace (21/10/2026): refeita na
-- hora a cada mudança nos cards (tabela pequena), para Gestão e KPIs nunca
-- divergirem. A atualização completa chama a mesma rotina.
create or replace function sinistros_kpi_fato_cards()
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  delete from sinistros_kpi_fato where origem = 'workspace';
  insert into sinistros_kpi_fato (id, origem, produto, nosso_numero, numero_sinistro, seguradora, grupo_chave,
    tipo_sinistro, situacao, dt_aviso, dt_encerramento, vl_avisado, vl_indenizado, segurado)
  select s.id, 'workspace', s.produto, coalesce(s.nosso_numero, sc.nosso_numero), coalesce(s.numero_sinistro_seguradora, sc.numero_sinistro), s.seguradora,
    -- ficha do card > (card vindo do Corp sem ficha) código do produtor da apólice > texto do PDF
    coalesce('g:' || i.grupo_id::text, 'i:' || i.id::text,
             case when sc.id is not null then coalesce('g:' || ic.grupo_id::text, 'i:' || ic.id::text, vi.chave, 't:' || trim(ap.texto)) end),
    case when s.tipo = 'ocupado' then 'ocupado' when s.tipo like 'chaves%' then 'chaves' else sc.subtipo end,
    case when s.etapa = 'encerrado' and s.desfecho = 'indenizado' then 'INDENIZADO'
         when s.etapa = 'encerrado' then 'ENCERRADO SEM INDENIZAÇÃO' else 'EM ANDAMENTO' end,
    coalesce(s.enviado_em::date, s.created_at::date), case when s.etapa = 'encerrado' then coalesce(s.encerrado_em, s.updated_at::date) end,
    s.valor_avisado,
    -- Indenizado = soma das indenizações registradas (ou o valor trazido do Corp).
    coalesce((select nullif(sum(x.valor), 0) from sinistro_indenizacoes x where x.sinistro_id = s.id), sc.vl_indenizado),
    coalesce(s.locador_nome, s.locatario_nome)
  from sinistros s
  left join imobiliarias i on i.id = s.imobiliaria_id
  left join sinistros_corp sc on sc.id = s.sinistro_corp_id
  left join imobiliarias ic on sc.id is not null and s.imobiliaria_id is null and ic.id = imobiliaria_por_apolice_corp(sc.nosso_numero)
  left join lateral (
    select p.imobiliaria_texto texto from producao_unificada p
    where sc.id is not null and s.imobiliaria_id is null and p.fonte = 'corp' and p.origem_corp_numero = sc.nosso_numero
      and p.produto = case when sc.produto in ('fianca', 'capitalizacao', 'automovel') then sc.produto else 're' end
    limit 1
  ) ap on true
  left join sinistros_kpi_vinculo vi on vi.texto = trim(ap.texto)
  where s.etapa not in ('rascunho', 'cancelado');

  insert into sinistros_kpi_grupos (chave, nome, tipo)
  select distinct on (f.grupo_chave) f.grupo_chave, coalesce(g.nome, nullif(i.apelido, ''), i.nome, f.grupo_chave),
    case when g.id is not null then 'grupo' else 'imobiliaria' end
  from sinistros_kpi_fato f
  left join imobiliarias i on f.grupo_chave = 'i:' || i.id::text
  left join imobiliaria_grupos g on f.grupo_chave = 'g:' || g.id::text
  where f.origem = 'workspace' and f.grupo_chave ~ '^[ig]:'
    and not exists (select 1 from sinistros_kpi_grupos k where k.chave = f.grupo_chave)
  order by f.grupo_chave;
end;
$$;
revoke execute on function sinistros_kpi_fato_cards() from anon, public, authenticated;

create or replace function sinistros_kpi_fato_cards_gatilho()
returns trigger language plpgsql security definer set search_path to 'public'
as $$ begin perform sinistros_kpi_fato_cards(); return null; end; $$;

drop trigger if exists sinistros_kpi_fato_cards on sinistros;
create trigger sinistros_kpi_fato_cards
  after insert or delete or update of etapa, desfecho, encerrado_em, produto, seguradora, imobiliaria_id, enviado_em,
    valor_avisado, tipo, locador_nome, locatario_nome, numero_sinistro_seguradora, nosso_numero
  on sinistros for each statement execute function sinistros_kpi_fato_cards_gatilho();

drop trigger if exists sinistros_kpi_fato_indenizacoes on sinistro_indenizacoes;
create trigger sinistros_kpi_fato_indenizacoes
  after insert or delete or update on sinistro_indenizacoes
  for each statement execute function sinistros_kpi_fato_cards_gatilho();

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

drop function if exists kpis_sinistros_bloco(date, date, text[], text, text[], text[]);
create or replace function kpis_sinistros_bloco(
  p_ini date, p_fim date, p_segs text[], p_grupo text, p_tipos text[], p_sits text[], p_prods text[] default null
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
      and (p_prods is null or f.produto = any(p_prods))
      and (p_grupo is null or f.grupo_chave = p_grupo)
      and (p_tipos is null or coalesce(f.tipo_sinistro, 'nao_informado') = any(p_tipos))
  ),
  fs as (select * from f where p_sits is null or sit = any(p_sits)),
  c as (
    select cm.mes, sum(cm.vigentes) vigentes, sum(cm.premio_ganho) premio_ganho
    from sinistros_kpi_carteira_mes cm
    where cm.mes between p_ini and p_fim
      and (p_segs is null or cm.seguradora = any(p_segs))
      and (p_prods is null or cm.produto = any(p_prods))
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

drop function if exists kpis_sinistros_dashboard(date, date, text[], text, text[], text[]);
create or replace function kpis_sinistros_dashboard(
  p_inicio date, p_fim date,
  p_seguradoras text[] default null, p_grupo text default null,
  p_tipos text[] default null, p_situacoes text[] default null,
  p_produtos text[] default null
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
      and (p_produtos is null or f.produto = any(p_produtos))
      and (p_grupo is null or f.grupo_chave = p_grupo)
      and (p_tipos is null or coalesce(f.tipo_sinistro, 'nao_informado') = any(p_tipos))
      and (p_situacoes is null or (case when f.situacao in ('PENDENTE', 'EM ANDAMENTO') then 'em_aberto'
           when f.situacao = 'INDENIZADO' then 'indenizado' else 'sem_indenizacao' end) = any(p_situacoes))
  ),
  c as (
    select cm.* from sinistros_kpi_carteira_mes cm
    where cm.mes between p_inicio and p_fim
      and (p_seguradoras is null or cm.seguradora = any(p_seguradoras))
      and (p_produtos is null or cm.produto = any(p_produtos))
      and (p_grupo is null or cm.grupo_chave = p_grupo)
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
  quebra_prod as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'produto', pf.produto, 'avisados', pf.avisados, 'indenizados', pf.indenizados, 'indenizado', pf.indenizado,
      'em_aberto', pf.em_aberto, 'vigentes_media', pc.vigentes_media, 'premio_ganho', pc.premio_ganho
    ) order by pf.indenizado desc, pf.avisados desc), '[]'::jsonb) j
    from (
      select f.produto,
        count(*) filter (where f.dt_aviso between p_inicio and fim_dia) avisados,
        count(*) filter (where f.sit = 'indenizado' and f.dt_encerramento between p_inicio and fim_dia) indenizados,
        round(coalesce(sum(f.vl_indenizado) filter (where f.sit = 'indenizado' and f.dt_encerramento between p_inicio and fim_dia), 0)) indenizado,
        count(*) filter (where f.dt_aviso <= fim_dia and (f.dt_encerramento > fim_dia or (f.dt_encerramento is null and f.sit = 'em_aberto'))) em_aberto
      from f group by 1
    ) pf
    left join (select c.produto, round(sum(c.vigentes)::numeric / n) vigentes_media, round(sum(c.premio_ganho)) premio_ganho from c group by 1) pc on pc.produto = pf.produto
    where pf.avisados > 0 or pf.indenizado > 0 or pf.em_aberto > 0
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
      'produto', l.produto,
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
    where m.enviado_em is not null and m.etapa <> 'cancelado' and m.origem <> 'corp'
      and (p_produtos is null or 'fianca' = any(p_produtos))
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
    'resumo', kpis_sinistros_bloco(p_inicio, p_fim, p_seguradoras, p_grupo, p_tipos, p_situacoes, p_produtos),
    'anterior', kpis_sinistros_bloco((p_inicio - make_interval(months => n))::date, (p_fim - make_interval(months => n))::date, p_seguradoras, p_grupo, p_tipos, p_situacoes, p_produtos),
    'ano_anterior', kpis_sinistros_bloco((p_inicio - interval '12 months')::date, (p_fim - interval '12 months')::date, p_seguradoras, p_grupo, p_tipos, p_situacoes, p_produtos),
    'carteira', case when p_grupo is not null then kpis_sinistros_bloco(p_inicio, p_fim, p_seguradoras, null, p_tipos, p_situacoes, p_produtos) end,
    'mensal', (select j from mensal),
    'por_seguradora', (select j from quebra_seg),
    'por_tipo', (select j from quebra_tipo),
    'por_produto', (select j from quebra_prod),
    'ranking', (select j from ranking),
    'sinistros', (select j from lista),
    'processo', (select j from processo),
    'opcoes_produtos', (select coalesce(jsonb_agg(x.p order by x.p), '[]'::jsonb) from (
        select distinct produto p from sinistros_kpi_fato union select distinct produto from sinistros_kpi_carteira_mes where vigentes > 0) x),
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

revoke execute on function kpis_sinistros_bloco(date, date, text[], text, text[], text[], text[]) from anon, public, authenticated;
revoke execute on function kpis_sinistros_dashboard(date, date, text[], text, text[], text[], text[]) from anon, public;
grant execute on function kpis_sinistros_dashboard(date, date, text[], text, text[], text[], text[]) to authenticated;
revoke execute on function opcoes_grupos_sinistros() from anon, public;
grant execute on function opcoes_grupos_sinistros() to authenticated;
