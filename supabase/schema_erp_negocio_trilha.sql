-- ERP O2 — trilha do negócio (cotação → proposta → apólice → renovação) — definições aplicadas no banco em 02/11/2026.
-- Estas definições já estão no Supabase; o arquivo existe para o banco poder ser refeito e para o código ficar versionado.
-- Lotes (desfazer: delete de erp_negocio_elos / erp_negocio com o lote):
--   RENOV-*   card "RENOVAÇÃO … MM.AAAA" ↔ apólices da imobiliária que VENCEM no mês do título
--   COTPLAN-* cotação de Fiança (producao_unificada) ↔ apólice por locatário (partes) + data
--   COTRE-*   cotação convertida de RE/Auto ↔ apólice por imobiliária + prêmio + data
--   PLANAPO-* linha arquivada de planilha com nº de APÓLICE ↔ apólice (CPF confere); etapa pelo tipo da aba (renovacao/endosso/planilha_cotacao)
--   EMAIL-*   e-mails já ligados a um documento entram na trilha do negócio
-- Arquivo das planilhas: scripts/erp/arquivar-planilhas-cotacao.mjs (lote PLAN-0211).

-- ===== tabelas de ARQUIVO das planilhas congeladas (não disparam baixa nem painel) =====
create table if not exists public.erp_planilha_abas (
  arquivo_id text not null, aba text not null, cabecalho_linha int, colunas jsonb not null default '[]', n_linhas int not null default 0,
  nome_arquivo text, pasta text, lote text, lido_em timestamptz not null default now(), primary key (arquivo_id, aba));
create table if not exists public.erp_planilha_linhas (
  arquivo_id text not null, aba text not null, linha_n int not null, dados jsonb not null, lote text, primary key (arquivo_id, aba, linha_n));
create index if not exists erp_planilha_linhas_lote on public.erp_planilha_linhas (lote);
alter table public.erp_planilha_abas enable row level security;
alter table public.erp_planilha_linhas enable row level security;
create policy erp_planilha_abas_o2 on public.erp_planilha_abas for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
create policy erp_planilha_linhas_o2 on public.erp_planilha_linhas for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());

-- ===== catálogo =====
insert into erp_dominios (dominio, valor, rotulo, descricao, ordem, ativo) values
 ('etapa_negocio', 'renovacao_de', 'Apólice que vence (renovação)', 'Apólice vigente que o card de renovação vai renovar', 8, true),
 ('metodo_elo_negocio', 'renovacao_vence_no_mes', 'Card de renovação: apólices da imobiliária que vencem no mês do título', null, 9, true),
 ('etapa_negocio', 'email', 'E-mail do negócio', 'E-mail (conversa) ligado ao documento do negócio', 9, true),
 ('metodo_elo_negocio', 'email_documento', 'E-mail ligado ao documento (erp_emails.documento_id)', null, 10, true)
on conflict do nothing;

-- ===== funções auxiliares =====
create or replace function public.erp_num_seguro(t text) returns numeric language sql immutable as $$
  select case when t ~ '^-?\d+(\.\d+)?$' then t::numeric when t ~ '^-?\d{1,3}(\.\d{3})*,\d+$' then replace(replace(t, '.', ''), ',', '.')::numeric when t ~ '^-?\d+,\d+$' then replace(t, ',', '.')::numeric end $$;

create or replace function public.erp_tipo_aba_planilha(aba text) returns text language sql immutable as $$
  select case when aba ~* '^(c[óo]pia de )?(base )?(rn\M|renova)' then 'renovacao' when aba ~* '^endosso' then 'endosso' when aba ~* '^cancelamento' then 'cancelamento' else 'outra' end $$;

-- ===== card de renovação ↔ apólices que vencem no mês do título =====
create or replace function public.erp_negocio_renovacao_cards_calcular(p_lote text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lote text := coalesce(p_lote, 'RENOV-' || to_char(now(), 'YYYYMMDD-HH24MI')); v_neg int; v_elos int;
begin
  delete from erp_negocio where lote like 'RENOV-%';
  create temp table _c on commit drop as
    select b.id doc_id, o.entity_type_id, o.item_id, b.imobiliaria_principal_id imob, b.situacao, o.titulo,
           nullif(regexp_replace(coalesce(o.dados_legiveis->>'Quantidade de endereços', ''), '\D', '', 'g'), '')::int esp,
           make_date(substring(o.titulo from '(\d{4})\s*$')::int, substring(o.titulo from '(\d{2})\.\d{4}\s*$')::int, 1) mes,
           array_remove(array[case when upper(o.titulo) ~ 'TOKIO' then 'TOKI' end, case when upper(o.titulo) ~ 'PORTO' then 'PORT' end, case when upper(o.titulo) ~ '(YELLUM|YELUM|LIBERTY)' then 'YELU' end,
                              case when upper(o.titulo) ~ 'ALLIANZ' then 'ALLI' end, case when upper(o.titulo) ~ 'ZURICH' then 'ZURI' end, case when upper(o.titulo) ~ 'POTTENCIAL' then 'POTT' end,
                              case when upper(o.titulo) ~ '\mTOO\M' then 'TOO' end, case when upper(o.titulo) ~ 'ALFA' then 'ALF' end, case when upper(o.titulo) ~ 'BRADESCO' then 'BRAD' end], null) segs
      from erp_origens o join erp_documentos b on b.id = o.documento_id
     where o.entity_type_id in (1042, 1046, 1048, 1050) and b.origem = 'bitrix' and b.imobiliaria_principal_id is not null
       and o.titulo ~* '^renova' and o.titulo ~ '\d{2}\.\d{4}\s*$' and substring(o.titulo from '(\d{2})\.\d{4}\s*$')::int between 1 and 12;
  create temp table _v on commit drop as
    select c.doc_id, a.id aid, a.numero_apolice from _c c join erp_documentos a on a.imobiliaria_principal_id = c.imob and a.tipo = 'A' and a.origem <> 'bitrix' and a.situacao in ('vigente', 'vencido', 'cancelado')
      and a.vigencia_fim >= c.mes and a.vigencia_fim < (c.mes + interval '1 month')::date
      and (cardinality(c.segs) = 0 or exists (select 1 from erp_seguradoras s where s.id = a.seguradora_id and s.abreviacao = any (c.segs)));
  create index on _v (doc_id);
  create temp table _neg on commit drop as select doc_id, gen_random_uuid() negocio_id from (select distinct doc_id from _v) z;
  insert into erp_negocio (id, imobiliaria_id, lote) select n.negocio_id, (select imob from _c where doc_id = n.doc_id limit 1), v_lote from _neg n;
  get diagnostics v_neg = row_count;
  insert into erp_negocio_elos (negocio_id, etapa, documento_id, ref, metodo, confianca, nivel, evidencia, lote)
    select n.negocio_id, 'card_bitrix', c.doc_id, c.entity_type_id || ':' || c.item_id, 'renovacao_vence_no_mes', 'media', 6,
           jsonb_build_object('titulo', c.titulo, 'mes', c.mes, 'itens_esperados', c.esp, 'apolices_que_vencem', (select count(*) from _v v where v.doc_id = c.doc_id)), v_lote
      from _neg n join (select distinct on (doc_id) * from _c order by doc_id) c on c.doc_id = n.doc_id
    union all select n.negocio_id, 'renovacao_de', v.aid, null, 'renovacao_vence_no_mes',
           case when c.esp is null or abs((select count(*) from _v x where x.doc_id = c.doc_id) - c.esp) <= greatest(3, c.esp * 0.25) then 'media' else 'baixa' end, 3, jsonb_build_object('apolice', v.numero_apolice), v_lote
      from _v v join _neg n on n.doc_id = v.doc_id join (select distinct on (doc_id) * from _c order by doc_id) c on c.doc_id = v.doc_id
    on conflict do nothing;
  get diagnostics v_elos = row_count;
  return jsonb_build_object('lote', v_lote, 'cards_de_renovacao', v_neg, 'elos', v_elos);
end $$;

-- ===== cotação de Fiança (planilha, producao_unificada) ↔ apólice: locatário (partes) + data (-30/+90 dias) =====
create or replace function public.erp_negocio_cotacao_planilha_ligar(p_lote text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lote text := coalesce(p_lote, 'COTPLAN-' || to_char(now(), 'YYYYMMDD-HH24MI')); v_elos int; v_novos int;
begin
  delete from erp_negocio_elos where lote like 'COTPLAN-%';
  delete from erp_negocio where lote like 'COTPLAN-%';
  create temp table _c on commit drop as
    select distinct on (chave_caso) id, chave_caso, status_padrao, locatario_id, coalesce(data_efetivacao, data_recebimento) dt, seguradora, premio, imobiliaria_texto, competencia_arquivo
      from producao_unificada where fonte='planilha' and tipo='novo' and produto='fianca' and locatario_id is not null
     order by chave_caso, herdada, competencia_arquivo;
  create index on _c (locatario_id);
  create temp table _p on commit drop as
    select distinct p.locatario_id, p.documento_id, d.vigencia_inicio, d.numero_apolice, p.papel
      from (select locatario_id, documento_id, papel from apolice_partes union select locatario_id, documento_id, papel from erp_doc_partes_acervo) p
      join erp_documentos d on d.id = p.documento_id
     where d.origem <> 'bitrix' and d.tipo = 'A' and p.locatario_id is not null and d.vigencia_inicio is not null;
  create index on _p (locatario_id);
  create temp table _m on commit drop as
    select distinct on (c.id) c.id cot_id, c.status_padrao, c.dt, c.seguradora, c.imobiliaria_texto, p.documento_id, p.numero_apolice, p.papel, p.vigencia_inicio,
           abs(p.vigencia_inicio - c.dt) dist,
           count(*) over (partition by c.id) n_cand
      from _c c join _p p on p.locatario_id = c.locatario_id and c.dt is not null and p.vigencia_inicio between c.dt - 30 and c.dt + 90
     order by c.id, abs(p.vigencia_inicio - c.dt);
  create temp table _n on commit drop as
    select m.*, coalesce((select e.negocio_id from erp_negocio_elos e where e.documento_id = m.documento_id and e.etapa in ('apolice', 'proposta') limit 1), null) neg_existente
      from _m m;
  create temp table _neg on commit drop as
    select documento_id, gen_random_uuid() negocio_id from (select distinct documento_id from _n where neg_existente is null) z;
  insert into erp_negocio (id, imobiliaria_id, lote)
    select g.negocio_id, (select imobiliaria_principal_id from erp_documentos where id = g.documento_id), v_lote from _neg g;
  get diagnostics v_novos = row_count;
  insert into erp_negocio_elos (negocio_id, etapa, documento_id, ref, metodo, confianca, nivel, evidencia, lote)
    select coalesce(n.neg_existente, g.negocio_id), 'planilha_cotacao', null, n.cot_id::text, 'cotacao_locatario_data',
           case when n.status_padrao = 'Convertido' and n.n_cand = 1 then 'alta' when n.status_padrao in ('Convertido', 'Aprovado') then 'media' else 'baixa' end, 7,
           jsonb_build_object('status', n.status_padrao, 'data_cotacao', n.dt, 'seguradora_planilha', n.seguradora, 'imobiliaria_planilha', n.imobiliaria_texto, 'candidatas', n.n_cand, 'dias_ate_vigencia', n.vigencia_inicio - n.dt), v_lote
      from _n n left join _neg g on g.documento_id = n.documento_id and n.neg_existente is null
    union all
    select g.negocio_id, 'apolice', g.documento_id, null, 'cotacao_locatario_data', 'media', 3, jsonb_build_object('apolice', (select numero_apolice from _n where documento_id = g.documento_id limit 1)), v_lote from _neg g
    on conflict do nothing;
  get diagnostics v_elos = row_count;
  return jsonb_build_object('lote', v_lote, 'cotacoes_ligadas', (select count(*) from _m), 'negocios_novos', v_novos, 'elos', v_elos);
end $$;

-- ===== cotação convertida de RE/Auto ↔ apólice: imobiliária (planilha_re) + prêmio (±R$1) + vigência (-30/+90 dias) =====
create or replace function public.erp_negocio_cotacao_re_ligar(p_lote text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lote text := coalesce(p_lote, 'COTRE-' || to_char(now(), 'YYYYMMDD-HH24MI')); v_elos int; v_novos int;
begin
  delete from erp_negocio_elos where lote like 'COTRE-%';
  delete from erp_negocio where lote like 'COTRE-%';
  create temp table _c on commit drop as
    select distinct on (c.chave_caso) c.id, c.produto, c.premio, coalesce(c.data_efetivacao, c.data_recebimento) dt, c.seguradora, c.imobiliaria_texto, f.imobiliaria_id
      from producao_unificada c join imobiliaria_registros_fonte f on f.fonte = 'planilha_re' and upper(f.nome_original) = upper(c.imobiliaria_texto) and f.imobiliaria_id is not null
     where c.fonte='planilha' and c.tipo='novo' and c.produto in ('re','automovel') and c.premio is not null and c.status_padrao = 'Convertido'
     order by c.chave_caso, c.herdada, c.competencia_arquivo;
  create index on _c (imobiliaria_id);
  create temp table _d on commit drop as
    select id, imobiliaria_principal_id imob, premio_total, premio_liquido, vigencia_inicio, numero_apolice from erp_documentos where tipo='A' and origem<>'bitrix' and vigencia_inicio is not null and imobiliaria_principal_id is not null;
  create index on _d (imob);
  create temp table _m on commit drop as
    select c.id cot_id, c.dt, c.seguradora, c.imobiliaria_texto, d.id documento_id, d.numero_apolice, d.vigencia_inicio,
           least(abs(d.premio_total - c.premio), abs(d.premio_liquido - c.premio)) dif,
           row_number() over (partition by c.id order by least(abs(d.premio_total - c.premio), abs(d.premio_liquido - c.premio)), abs(d.vigencia_inicio - c.dt)) rn,
           count(*) over (partition by c.id) n_cand
      from _c c join _d d on d.imob = c.imobiliaria_id and c.dt is not null and d.vigencia_inicio between c.dt - 30 and c.dt + 90
       and (abs(d.premio_total - c.premio) <= 1 or abs(d.premio_liquido - c.premio) <= 1);
  delete from _m where rn > 1;
  create temp table _n on commit drop as
    select m.*, (select e.negocio_id from erp_negocio_elos e where e.documento_id = m.documento_id and e.etapa in ('apolice', 'proposta') limit 1) neg_existente from _m m;
  create temp table _neg on commit drop as select documento_id, gen_random_uuid() negocio_id from (select distinct documento_id from _n where neg_existente is null) z;
  insert into erp_negocio (id, imobiliaria_id, lote) select g.negocio_id, (select imobiliaria_principal_id from erp_documentos where id = g.documento_id), v_lote from _neg g;
  get diagnostics v_novos = row_count;
  insert into erp_negocio_elos (negocio_id, etapa, documento_id, ref, metodo, confianca, nivel, evidencia, lote)
    select coalesce(n.neg_existente, g.negocio_id), 'planilha_cotacao', null, n.cot_id::text, 'cotacao_imob_premio_data',
           case when n.n_cand = 1 and n.dif <= 0.05 then 'alta' else 'media' end, 7,
           jsonb_build_object('data_cotacao', n.dt, 'seguradora_planilha', n.seguradora, 'imobiliaria_planilha', n.imobiliaria_texto, 'candidatas', n.n_cand, 'dif_premio', n.dif), v_lote
      from _n n left join _neg g on g.documento_id = n.documento_id and n.neg_existente is null
    union all
    select g.negocio_id, 'apolice', g.documento_id, null, 'cotacao_imob_premio_data', 'media', 3, jsonb_build_object('apolice', (select numero_apolice from _n where documento_id = g.documento_id limit 1)), v_lote from _neg g
    on conflict do nothing;
  get diagnostics v_elos = row_count;
  return jsonb_build_object('lote', v_lote, 'ligadas', (select count(*) from _m), 'negocios_novos', v_novos, 'elos', v_elos);
end $$;

-- ===== linha arquivada da planilha com nº de APÓLICE ↔ apólice (CPF confere); etapa conforme o tipo da aba =====
create or replace function public.erp_negocio_planilha_por_apolice_ligar(p_lote text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lote text := coalesce(p_lote, 'PLANAPO-' || to_char(now(), 'YYYYMMDD-HH24MI')); v_elos int; v_novos int;
begin
  delete from erp_negocio_elos where lote like 'PLANAPO-%';
  delete from erp_negocio where lote like 'PLANAPO-%';
  create temp table _l on commit drop as
    select distinct on (apo, arquivo_id, aba) arquivo_id, aba, linha_n, apo, cpf, nome_seg, status from (
      select arquivo_id, aba, linha_n,
        regexp_replace(coalesce(dados->>'APOLICE', dados->>'APÓLICE', ''), '\D', '', 'g') apo,
        regexp_replace(coalesce(dados->>'CPF', dados->>'CPF DO LOCATÁRIO', dados->>'CPF/CNPJ TITULAR', dados->>'CPF/CNPJ', dados->>'CPF/CNPJ LOCATÁRIO', ''), '\D', '', 'g') cpf,
        coalesce(dados->>'SEGURADO', dados->>'LOCATÁRIO', dados->>'LOCATÁRIO/TITULAR', dados->>'Nome / Locatário') nome_seg,
        coalesce(dados->>'STATUS', dados->>'STATUS FINAL') status
      from erp_planilha_linhas) z
     where length(apo) >= 5 order by apo, arquivo_id, aba, linha_n;
  create index on _l (apo);
  create temp table _d on commit drop as
    select id, regexp_replace(numero_apolice, '\D', '', 'g') apo, numero_apolice, imobiliaria_principal_id imob, count(*) over (partition by regexp_replace(numero_apolice, '\D', '', 'g')) k
      from erp_documentos where origem <> 'bitrix' and tipo = 'A' and numero_apolice is not null;
  create index on _d (apo);
  create temp table _cpfs on commit drop as
    select distinct p.documento_id, regexp_replace(coalesce(lo.cpf, ''), '\D', '', 'g') cpf from (select documento_id, locatario_id from apolice_partes union select documento_id, locatario_id from erp_doc_partes_acervo union select id, locatario_id from erp_documentos where locatario_id is not null and tipo = 'A') p join locatarios lo on lo.id = p.locatario_id;
  create index on _cpfs (documento_id);
  create temp table _m on commit drop as
    select l.*, d.id documento_id, d.numero_apolice, d.k,
      case when length(l.cpf) >= 11 and exists (select 1 from _cpfs c where c.documento_id = d.id and c.cpf = l.cpf) then 'cpf_confere'
           when length(l.cpf) >= 11 and exists (select 1 from _cpfs c where c.documento_id = d.id and length(c.cpf) >= 11) then 'cpf_difere'
           else 'sem_cpf_para_conferir' end conf
      from _l l join _d d on d.apo = l.apo;
  create temp table _n on commit drop as
    select m.*, (select e.negocio_id from erp_negocio_elos e where e.documento_id = m.documento_id and e.etapa in ('apolice', 'proposta') limit 1) neg_existente from _m m;
  create temp table _neg on commit drop as select documento_id, gen_random_uuid() negocio_id from (select distinct documento_id from _n where neg_existente is null) z;
  insert into erp_negocio (id, imobiliaria_id, lote) select g.negocio_id, (select imobiliaria_principal_id from erp_documentos where id = g.documento_id), v_lote from _neg g;
  get diagnostics v_novos = row_count;
  insert into erp_negocio_elos (negocio_id, etapa, documento_id, ref, metodo, confianca, nivel, evidencia, lote)
    select coalesce(n.neg_existente, g.negocio_id), case erp_tipo_aba_planilha(n.aba) when 'renovacao' then 'renovacao' when 'endosso' then 'endosso' else 'planilha_cotacao' end, null::uuid, n.arquivo_id || '|' || n.aba || '|' || n.linha_n, 'planilha_numero_apolice',
           case when n.conf = 'cpf_difere' then 'baixa' when n.k > 1 then 'media' else 'alta' end, 6::smallint,
           jsonb_build_object('tipo_aba', erp_tipo_aba_planilha(n.aba), 'aba', n.aba, 'conferencia', n.conf, 'apolice', n.numero_apolice, 'segurado_planilha', n.nome_seg, 'status_planilha', n.status, 'docs_com_o_mesmo_numero', n.k), v_lote
      from _n n left join _neg g on g.documento_id = n.documento_id and n.neg_existente is null
    union all
    select g.negocio_id, 'apolice', g.documento_id, null, 'planilha_numero_apolice', 'media', 3::smallint, jsonb_build_object('apolice', (select numero_apolice from _n where documento_id = g.documento_id limit 1)), v_lote from _neg g
    on conflict do nothing;
  get diagnostics v_elos = row_count;
  return jsonb_build_object('lote', v_lote, 'linhas_ligadas', (select count(*) from _m), 'apolices', (select count(distinct documento_id) from _m), 'negocios_novos', v_novos, 'elos', v_elos);
end $$;

-- ===== e-mails já ligados a um documento entram na trilha do negócio =====
create or replace function public.erp_negocio_emails_ligar(p_lote text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lote text := coalesce(p_lote, 'EMAIL-' || to_char(now(), 'YYYYMMDD-HH24MI')); v_elos int;
begin
  delete from erp_negocio_elos where lote like 'EMAIL-%';
  insert into erp_negocio_elos (negocio_id, etapa, documento_id, ref, metodo, confianca, nivel, evidencia, lote)
    select distinct e.negocio_id, 'email', null::uuid, m.message_id, 'email_documento', 'media', 5::smallint,
           jsonb_build_object('thread_id', m.thread_id, 'data', m.data, 'assunto', m.assunto, 'ligacao', m.ligacao, 'documento_id', m.documento_id), v_lote
      from erp_negocio_elos e join erp_emails m on m.documento_id = e.documento_id
     where e.documento_id is not null and e.etapa in ('apolice', 'proposta', 'card_bitrix', 'renovacao_de');
  get diagnostics v_elos = row_count;
  return jsonb_build_object('lote', v_lote, 'elos_email', v_elos, 'negocios', (select count(distinct negocio_id) from erp_negocio_elos where lote = v_lote));
end $$;

-- ===== visões (só leitura) =====
create or replace view erp_renovacoes_futuras with (security_invoker = true) as
select to_char(date_trunc('month', d.vigencia_fim), 'YYYY-MM') mes_vencimento, s.abreviacao seguradora, r.nome ramo, count(*) apolices_vencendo,
       round(sum(coalesce(d.comissao_valor, 0)), 2) comissao_em_jogo, round(sum(coalesce(d.premio_liquido, 0)), 2) premio_liquido,
       count(*) filter (where exists (select 1 from erp_documentos n where n.documento_renovado_id = d.id)) ja_renovadas,
       count(*) filter (where exists (select 1 from erp_negocio_elos e where e.documento_id = d.id and e.etapa = 'renovacao_de')) com_card_de_renovacao
from erp_documentos d join erp_seguradoras s on s.id = d.seguradora_id left join erp_ramos r on r.id = d.ramo_id
where d.tipo = 'A' and d.situacao = 'vigente' and d.vigencia_fim >= date_trunc('month', current_date)::date
group by 1, 2, 3;

create or replace view erp_renovacao_participacao_mensal with (security_invoker = true) as
select to_char(date_trunc('month', d.vigencia_inicio), 'YYYY-MM') mes_inicio_vigencia, count(*) apolices,
       round(100.0 * count(*) filter (where d.documento_renovado_id is not null) / count(*), 1) pct_apolices_renovacao,
       round(sum(coalesce(d.comissao_valor, 0)), 2) comissao,
       round(100.0 * sum(coalesce(d.comissao_valor, 0)) filter (where d.documento_renovado_id is not null) / nullif(sum(coalesce(d.comissao_valor, 0)), 0), 1) pct_comissao_renovacao
from erp_documentos d where d.tipo = 'A' and d.situacao in ('vigente', 'vencido', 'cancelado') and d.vigencia_inicio is not null group by 1;

create or replace view erp_negocio_comparacao_cotacao_apolice with (security_invoker = true) as
select c.negocio_id, c.lote, c.confianca, p.id cotacao_id, p.produto, p.status_padrao, p.seguradora seguradora_planilha, p.imobiliaria_texto,
       a.id documento_id, a.numero_apolice, a.premio_total, a.premio_liquido, p.premio premio_cotacao,
       coalesce(p.data_efetivacao, p.data_recebimento) data_cotacao, a.vigencia_inicio,
       a.vigencia_inicio - coalesce(p.data_efetivacao, p.data_recebimento) dias_ate_vigencia,
       round(p.premio - a.premio_total, 2) dif_vs_total, round(p.premio - a.premio_liquido, 2) dif_vs_liquido,
       case when least(abs(p.premio - a.premio_total), abs(p.premio - a.premio_liquido)) <= 1 then 'bate'
            when least(abs(p.premio - a.premio_total), abs(p.premio - a.premio_liquido)) <= greatest(p.premio * 0.05, 5) then 'perto'
            else 'diverge' end situacao_premio
  from erp_negocio_elos c
  join producao_unificada p on p.id::text = c.ref
  join erp_negocio_elos e on e.negocio_id = c.negocio_id and e.etapa = 'apolice'
  join erp_documentos a on a.id = e.documento_id
 where c.etapa = 'planilha_cotacao' and p.premio is not null;

create or replace view erp_negocio_comparacao_planilha_apolice with (security_invoker = true) as
select e.negocio_id, e.etapa, e.evidencia->>'tipo_aba' tipo_aba, e.confianca, e.evidencia->>'conferencia' conferencia_cpf, split_part(e.ref, '|', 1) arquivo_id, split_part(e.ref, '|', 2) aba, split_part(e.ref, '|', 3)::int linha_n,
       a.id documento_id, a.numero_apolice, a.premio_liquido, a.premio_total, a.vigencia_inicio,
       erp_num_seguro(coalesce(l.dados->>'PRÊM. LÍQ.', l.dados->>'PREMIO LIQUIDO', l.dados->>'PRÊMIO LÍQUIDO')) planilha_liquido,
       erp_num_seguro(coalesce(l.dados->>'PRÊM. TOTAL', l.dados->>'PREMIO TOTAL', l.dados->>'PRÊMIO TOTAL')) planilha_total
  from erp_negocio_elos e
  join erp_planilha_linhas l on l.arquivo_id = split_part(e.ref, '|', 1) and l.aba = split_part(e.ref, '|', 2) and l.linha_n = split_part(e.ref, '|', 3)::int
  join erp_documentos a on a.numero_apolice = e.evidencia->>'apolice' and a.tipo = 'A' and a.origem <> 'bitrix'
 where e.lote like 'PLANAPO-%' and e.metodo = 'planilha_numero_apolice';

-- Correção pontual de 02/11: prêmio da cotação de Fiança que divergia da apólice (erro de milhar/decimal da planilha) foi trocado pelo líquido da apólice;
-- o valor lido fica em producao_unificada.extras->>'premio_planilha_original' (+ extras.premio_corrigido_por).

-- Prêmio previsto da renovação segundo as abas de renovação das planilhas (1 linha por apólice: a última aba preenchida, líquido > 0).
create or replace view erp_renovacao_prevista_planilha with (security_invoker = true) as
select distinct on (v.documento_id) v.documento_id, v.numero_apolice, d.vigencia_fim, to_char(d.vigencia_fim, 'YYYY-MM') mes_vencimento, d.situacao,
       v.premio_liquido premio_liquido_atual, v.planilha_liquido premio_liquido_previsto,
       round(100.0 * (v.planilha_liquido / nullif(v.premio_liquido, 0) - 1), 1) reajuste_pct, v.aba, v.arquivo_id, v.linha_n
  from erp_negocio_comparacao_planilha_apolice v join erp_documentos d on d.id = v.documento_id
 where v.tipo_aba = 'renovacao' and v.planilha_liquido > 0 and v.premio_liquido > 0
 order by v.documento_id, v.arquivo_id desc, v.linha_n desc;

-- Renovações futuras: com base nas APÓLICES vigentes; a previsão replica as mesmas condições (prêmio e comissão atuais); controle pelo NÚMERO OFICIAL da apólice (decisão do Matheus, 02/11/2026).
-- situacao_renovacao: renovada (apólice nova aponta para ela via documento_renovado_id) | em_tratativa (card de renovação ou linha de aba de renovação) | sem_tratativa.
create or replace view erp_renovacao_controle with (security_invoker = true) as
select d.numero_apolice, d.id documento_id, s.abreviacao seguradora, r.nome ramo, d.imobiliaria_principal_id imobiliaria_id, i.nome imobiliaria,
       d.vigencia_inicio, d.vigencia_fim, to_char(d.vigencia_fim, 'YYYY-MM') mes_vencimento,
       d.premio_liquido, d.premio_total, d.comissao_pct, d.comissao_valor,
       n.numero_apolice apolice_nova, n.id documento_novo_id,
       exists (select 1 from erp_negocio_elos e where e.documento_id = d.id and e.etapa = 'renovacao_de') tem_card_renovacao,
       exists (select 1 from erp_negocio_elos e where e.etapa = 'renovacao' and e.evidencia->>'apolice' = d.numero_apolice) tem_linha_planilha_renovacao,
       case when n.id is not null then 'renovada'
            when exists (select 1 from erp_negocio_elos e where e.documento_id = d.id and e.etapa = 'renovacao_de')
              or exists (select 1 from erp_negocio_elos e where e.etapa = 'renovacao' and e.evidencia->>'apolice' = d.numero_apolice) then 'em_tratativa'
            else 'sem_tratativa' end situacao_renovacao
  from erp_documentos d
  join erp_seguradoras s on s.id = d.seguradora_id
  left join erp_ramos r on r.id = d.ramo_id
  left join imobiliarias i on i.id = d.imobiliaria_principal_id
  left join lateral (select x.id, x.numero_apolice from erp_documentos x where x.documento_renovado_id = d.id and x.tipo = 'A' order by x.vigencia_inicio limit 1) n on true
 where d.tipo = 'A' and d.situacao = 'vigente' and d.numero_apolice is not null and d.vigencia_fim >= current_date;

create or replace view erp_renovacao_previsao_mensal with (security_invoker = true) as
select mes_vencimento, count(*) apolices, round(sum(coalesce(premio_liquido, 0)), 2) premio_liquido_previsto, round(sum(coalesce(comissao_valor, 0)), 2) comissao_prevista,
       count(*) filter (where situacao_renovacao = 'renovada') renovadas, count(*) filter (where situacao_renovacao = 'em_tratativa') em_tratativa, count(*) filter (where situacao_renovacao = 'sem_tratativa') sem_tratativa,
       round(sum(coalesce(comissao_valor, 0)) filter (where situacao_renovacao = 'sem_tratativa'), 2) comissao_sem_tratativa
  from erp_renovacao_controle group by 1;

-- ===== NÃO RENOVADAS (histórico): perda e motivo — Matheus, 02/11/2026 =====
-- Apólices vencidas/canceladas desde 2022 sem apólice nova apontando para elas (documento_renovado_id). Motivo por prioridade: texto das abas de CANCELAMENTO das planilhas
-- (por nº da apólice sem zeros à esquerda, ou por nome do segurado/locatário + data da solicitação ±45 dias), sinistro aberto na apólice, cancelada no ERP sem motivo, sem informação.
-- Recalcular: select erp_nao_renovadas_calcular();
create table if not exists public.erp_nao_renovadas (
  documento_id uuid primary key references erp_documentos(id) on delete cascade,
  numero_apolice text, seguradora text, ramo text, imobiliaria_id uuid, vigencia_fim date, ano_fim int, situacao text,
  premio_liquido numeric, premio_total numeric, comissao_valor numeric,
  motivo text not null, motivo_fonte text not null, detalhe jsonb, calculado_em timestamptz not null default now());
create index if not exists erp_nao_renovadas_ano on public.erp_nao_renovadas (ano_fim, motivo);
alter table public.erp_nao_renovadas enable row level security;
create policy erp_nao_renovadas_o2 on public.erp_nao_renovadas for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
-- Funções erp_motivo_texto(), erp_norm_nome(), erp_data_iso() e erp_nao_renovadas_calcular(): a definição vigente está no banco
-- (select pg_get_functiondef('erp_nao_renovadas_calcular'::regproc)); migração "erp_nao_renovadas_calcular_v2".

-- ===== E-MAILS DE RENOVAÇÃO (Matheus, 02/11/2026: a equipe cobra a renovação e recebe os valores atualizados da locação por e-mail) =====
-- erp_renovacao_emails: e-mail com "renova" no assunto ↔ APÓLICE, pelo nome do segurado/locatário no assunto/trecho + imobiliária + mês do vencimento (±1). Recalcular: select erp_renovacao_emails_calcular();
-- Pistas do texto (erp_pista_renovacao): autoriza_renovar, nao_renovar, valor_atualizado. Depois de erp_nao_renovadas_calcular() rodar erp_nao_renovadas_aplicar_emails() (motivo vindo de e-mail = 'email_indicio').
-- erp_negocio_emails_renovacao_ligar (lote EMAILREN-*) liga a conversa ao card de renovação da imobiliária/mês. erp_renovacao_controle ganhou: emails_renovacao, ultimo_email, email_sinal_nao_renovar, email_valor_atualizado.
-- Definições vigentes: select pg_get_functiondef('<função>'::regproc) / pg_get_viewdef('<visão>'::regclass); migrações "erp_negocio_emails_renovacao_ligar", "erp_renovacao_emails_por_apolice", "erp_nao_renovadas_aplicar_emails", "erp_renovacao_controle_com_emails".
create table if not exists public.erp_renovacao_emails (
  documento_id uuid not null references erp_documentos(id) on delete cascade, message_id text not null, thread_id text, data timestamptz, de text, assunto text,
  mes_renovacao date, pistas text[], trecho text, calculado_em timestamptz not null default now(), primary key (documento_id, message_id));
create index if not exists erp_renovacao_emails_msg on public.erp_renovacao_emails (message_id);
alter table public.erp_renovacao_emails enable row level security;
create policy erp_renovacao_emails_o2 on public.erp_renovacao_emails for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());

-- ===== RENOVAÇÕES DAS PLANILHAS (abas RN <mês>, RENOVAÇÃO/RENOVAÇÕES, BASE RN…): 1 linha por RENOVAÇÃO = apólice que VENCE + fim de vigência — 02/11/2026 =====
-- Estado FINAL = versão mais recente arquivada (modificado_em do arquivo congelado); historico_status guarda o status de cada arquivo. Fonte nível 7. Recalcular: select erp_renovacao_planilha_calcular();
-- depois: select erp_renovacao_planilha_sucessora_provavel(); select erp_nao_renovadas_aplicar_planilha_renovacao();
-- Prêmio "2025" (anterior) é comparado com a apólice que VENCE; prêmio novo com a SUCESSORA (documento_renovado_id) — nunca com a mesma apólice. Valor 0 na planilha = ainda não preenchido.
create or replace function public.erp_data_serial(t text) returns date language sql immutable as $$
  select case when t ~ '^20[12]\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])' then left(t, 10)::date
              when t ~ '^\d{5}(\.\d+)?$' and t::numeric between 40000 and 60000 then (date '1899-12-30' + floor(t::numeric)::int) end $$;
create or replace function public.erp_pct_normal(n numeric) returns numeric language sql immutable as $$
  select case when n is null then null when abs(n) <= 1 then round(n * 100, 4) else n end $$;
create table if not exists public.erp_renovacao_planilha (
  chave text primary key, aba text, apolice_digitos text not null, numero_apolice text, fim_vigencia date, mes_fim text,
  documento_id uuid references erp_documentos(id) on delete set null, documento_sucessor_id uuid references erp_documentos(id) on delete set null,
  status_final text, situacao text, operacao text, cotador text, efetivador text, data_envio_cotacao date, data_efetivacao date, prazo_comunicado_dias int, prazo_comunicado_data date,
  segurado text, cpf text, imobiliaria text, seguradora text, ramo text, observacoes text,
  premio_liq_anterior numeric, premio_total_anterior numeric, comissao_pct_anterior numeric, comissao_recebida_anterior numeric,
  premio_liq_novo numeric, premio_total_novo numeric, comissao_pct_novo numeric, comissao_novo numeric, pct_repasse numeric,
  arquivo_final text, linha_final int, modificado_final timestamptz, versoes int, historico_status jsonb,
  cmp_anterior text, cmp_novo text, calculado_em timestamptz not null default now(),
  documento_sucessor_provavel_id uuid references erp_documentos(id) on delete set null, sucessora_provavel_premio_bate boolean);
create index if not exists erp_renovacao_planilha_doc on public.erp_renovacao_planilha (documento_id);
create index if not exists erp_renovacao_planilha_mes on public.erp_renovacao_planilha (mes_fim, situacao);
alter table public.erp_renovacao_planilha enable row level security;
create policy erp_renovacao_planilha_o2 on public.erp_renovacao_planilha for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
-- Funções erp_renovacao_planilha_calcular(), erp_renovacao_planilha_sucessora_provavel(), erp_nao_renovadas_aplicar_planilha_renovacao() e a visão erp_renovacao_prevista_planilha
-- (agora a partir de erp_renovacao_planilha): definição vigente no banco — pg_get_functiondef / pg_get_viewdef; migrações "erp_renovacao_planilha_estado_final",
-- "erp_renovacao_planilha_alimenta_motivo_e_previsto", "erp_renovacao_planilha_sucessora_provavel".

-- ===== MÉTRICA ÚNICA DE CONFIANÇA DOS VÍNCULOS (Matheus, 02/11/2026) =====
-- Pesos por evidência (erp_vinculo_pesos), multiplicador por fonte (erp_vinculo_fontes) e regras/faixas (erp_vinculo_regras) EDITÁVEIS sem código.
-- erp_vinculo_pontuar(evidencias jsonb) -> {pontos, faixa (vincula|provavel|sem_prova|vetado), fontes_independentes, vetos, usadas[], motivo_faixa}. Entrada: [{"e","fonte","par","corr"}].
-- erp_vinculo_pontuacao registra, por vínculo, pontos + faixa + evidências (lote p/ desfazer; NUNCA altera o vínculo). erp_vinculo_pontuar_retroativo(tipo, lote) aplica aos vínculos existentes.
-- Visões: erp_vinculo_distribuicao (faixa por tipo/lote) e erp_vinculo_limitrofes (vetos, 85–95, 65–75, pontos ok com fonte única).
-- regra modo_multiplicador: 0 = fonte de quem apresenta a evidência (padrão da proposta); 1 = média das duas pontas; 2 = a melhor das duas pontas.
create table if not exists public.erp_vinculo_pesos (
  evidencia text primary key, tipo text not null check (tipo in ('evidencia', 'penalidade', 'veto')), pontos numeric not null default 0,
  limite_faixa text check (limite_faixa in ('vetado', 'provavel')), rotulo text not null, ativo boolean not null default true, ordem int not null default 0);
create table if not exists public.erp_vinculo_fontes (fonte text primary key, rotulo text not null, multiplicador numeric not null, ordem int not null default 0);
create table if not exists public.erp_vinculo_regras (chave text primary key, valor numeric not null, rotulo text not null);
create table if not exists public.erp_vinculo_pontuacao (
  id bigint generated always as identity primary key, tipo_vinculo text not null, origem_ref text not null, destino_ref text not null,
  pontos numeric not null, faixa text not null, fontes_independentes int, motivo_faixa text, evidencias jsonb not null, vetos jsonb,
  ja_vinculado boolean, lote text not null, calculado_em timestamptz not null default now());
-- Valores iniciais (peso/fonte/regra): ver as tabelas no banco (select * from erp_vinculo_pesos, erp_vinculo_fontes, erp_vinculo_regras);
-- migrações "erp_vinculo_metrica_motor", "erp_vinculo_modo_multiplicador", "erp_vinculo_pontuar_retroativo" (+ _fix), "erp_vinculo_distribuicao_e_limitrofes".

-- ===== PROVAS CONCLUSIVAS (Matheus, 02/11/2026) =====
-- (1) PDF oficial legível que CITA o vínculo vincula sozinho (tentar ler sempre); (2) uma parcela cobrada e PAGA + nº da proposta vincula sozinha.
-- Contradição (CPF diferente, seguradora diferente, PDF cita OUTRO nº) = NÃO vincula: faixa 'conferir' + fila erp_vinculo_fila_conferencia (e-mails que citam o segurado; conversas de WhatsApp do Bitrix ainda fora do banco).
-- erp_vinculo_pesos.tipo passou a aceitar 'prova' (prova_pdf_cita_vinculo, prova_parcela_paga_com_proposta) e limite_faixa 'conferir' (pdf_cita_outro_numero).
-- Novo tipo retroativo: proposta_apolice (erp_vinculo_pontuar_retroativo). Definições vigentes no banco; migrações "erp_vinculo_provas_conclusivas" e "erp_vinculo_fila_conferencia".
