-- ERP próprio da O2 — Fase 0: carga do espelho do Corp e inferência das regras de repasse.
-- Aplicado em produção em 24/10/2026 (migrations erp_fase0_importar_por_fatia + erp_fase0_inferir_regras_fix).
--
-- COMO RODAR (sempre por fatia; a carga inteira de uma vez encheu o disco do Supabase — nano, 0,5 GB RAM):
--   select erp_importar_corp('2026-01-01', '2027-12-31', true);   -- documentos + produtores + parcelas estimadas
--   select erp_importar_corp('2025-01-01', '2026-01-01', true);
--   select erp_importar_corp('2024-01-01', '2025-01-01', true);
--   select erp_importar_corp('2022-01-01', '2024-01-01', false);  -- histórico sem parcelas
--   select erp_importar_corp('2020-01-01', '2022-01-01', false);
--   select erp_inferir_regras_repasse();                            -- regras esperadas + esperado×negociado + retrato
-- Conferência: select * from erp_conferencia_corp where dif_docs <> 0 or abs(dif_comissao) >= 0.01;
--   (contra o retrato CONGELADO do Power BI; diferenças = alterações do Corp após o fechamento,
--    ver corp_alteracoes_pos_fechamento. Contra a grade viva: 3408/3408 células iguais em 24/10/2026.)
--
-- Regras da carga: 1 documento por Nosso Nº; valores da linha incluir_corretora (a mesma que o PBI conta);
-- todos os produtores da grade viram erp_documento_produtores com o repasse NEGOCIADO (pct_com_prod / vl_com_prod);
-- cliente via producao_unificada (fonte corp) → locatarios; imobiliária via imobiliaria_registros_fonte (corp_produtor);
-- O2/canais/marcadores nunca viram imobiliária principal; parcelas são ESTIMADAS (prazo 30 dias + dia fixo da seguradora)
-- porque o espelho só traz a quantidade; auditoria fica desligada durante a carga (origem='corp_import' já marca).

create or replace function erp_importar_corp(p_desde date, p_ate date, p_gerar_parcelas boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_docs int; v_prods int; v_parc int := 0; v_com int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user <> 'postgres' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;

  alter table erp_documentos disable trigger erp_documentos_aud;
  alter table erp_documento_produtores disable trigger erp_documento_produtores_aud;
  alter table erp_parcelas disable trigger erp_parcelas_aud;
  alter table erp_comissoes disable trigger erp_comissoes_aud;

  create temp table _linha on commit drop as
  select g.*,
         row_number() over (partition by g.nosso_numero order by g.incluir_corretora desc, g.vl_com desc nulls last, g.id) as rn,
         bool_or(g.incluir_corretora) over (partition by g.nosso_numero) as tem_incluir
  from corp_grade g
  where g.ini_vig >= p_desde and g.ini_vig < p_ate;
  create index on _linha (nosso_numero);

  with principal as (select * from _linha where rn = 1),
  cli as (
    select origem_corp_numero::bigint as nn, (array_agg(locatario_id order by created_at))[1] as locatario_id
    from producao_unificada where fonte = 'corp' and locatario_id is not null and origem_corp_numero ~ '^\d+$'
      and origem_corp_numero::bigint in (select nosso_numero from _linha)
    group by 1
  ),
  imob as (
    select split_part(rf.chave_externa, '#', 1)::int as codigo, (array_agg(rf.imobiliaria_id))[1] as imobiliaria_id
    from imobiliaria_registros_fonte rf
    where rf.fonte = 'corp_produtor' and rf.imobiliaria_id is not null and split_part(rf.chave_externa, '#', 1) ~ '^\d+$'
    group by 1
  )
  insert into erp_documentos (nosso_numero, nosso_numero_corp, corretora_id, tipo, tipo_corp, seguradora_id, ramo_id, locatario_id,
    imobiliaria_principal_id, canal_venda, numero_apolice, numero_endosso, dt_proposta, vigencia_inicio, vigencia_fim, qtd_parcelas,
    premio_liquido, premio_adicional, premio_total, comissao_base, comissao_pct, comissao_valor, situacao, cancelado_em,
    competencia, congelado, fora_regra_pbi, origem, origem_ref, digitado_em)
  select p.nosso_numero, p.nosso_numero,
    coalesce(r.corretora_id, (select id from erp_corretoras where apelido = 'O2 Corretora')),
    coalesce(d.tipo_doc, case p.tipo when 'FAT' then 'F' when 'END' then 'M' when 'CANC' then 'X' else 'A' end),
    p.tipo, s.id, r.id, c.locatario_id,
    case when p.produtor ~* '^(O2 CORRETORA|SEGIMOB$|BASE SOFTWARE$|SUPERL[OÓ]GICA$|RETRANSMISS|TOMBAMENTO$)' then null else i.imobiliaria_id end,
    case when p.produtor ~* '^O2 CORRETORA' then 'venda_direta'
         when p.produtor ~* '^SEGIMOB$' then 'segimob'
         when p.produtor ~* '^SUPERL[OÓ]GICA$' then 'superlogica'
         when p.produtor ~* '^BASE SOFTWARE$' then 'base_software'
         when p.produtor ~* '^RETRANSMISS' then 'retransmissao'
         when p.produtor ~* '^TOMBAMENTO$' then 'tombamento'
         when p.canal_vendas is not null and p.canal_vendas <> '' then lower(p.canal_vendas) end,
    nullif(p.numero_apolice, '0'), nullif(p.numero_endosso, '0'), p.dt_proposta, p.ini_vig, p.fim_vig, p.parcelas,
    coalesce(p.pr_liquido, 0), coalesce(p.pr_adicional, 0), coalesce(p.pr_total, 0),
    'premio_liquido', coalesce(p.pct_com, 0), coalesce(p.vl_com, 0),
    case when p.cancelado = 'T' or p.tipo = 'CANC' then 'cancelado'
         when p.fim_vig < current_date then 'vencido'
         when coalesce(p.numero_apolice, '0') in ('0', '') then 'digitado'
         else 'vigente' end,
    case when p.cancelado = 'T' or p.tipo = 'CANC' then p.dt_proposta end,
    date_trunc('month', p.ini_vig)::date,
    date_trunc('month', p.ini_vig) < date_trunc('month', current_date),
    not p.tem_incluir,
    'corp_import', p.arquivo_id, p.dt_proposta
  from principal p
  left join corp_documentos d on d.nosso_numero = p.nosso_numero
  left join erp_seguradoras s on s.abreviacao = p.seg
  left join erp_ramos r on r.abreviacao = p.ramo
  left join cli c on c.nn = p.nosso_numero
  left join imob i on i.codigo = p.codigo_produtor
  on conflict (nosso_numero_corp) do update set
    tipo = excluded.tipo, tipo_corp = excluded.tipo_corp, seguradora_id = excluded.seguradora_id, ramo_id = excluded.ramo_id,
    locatario_id = coalesce(erp_documentos.locatario_id, excluded.locatario_id),
    imobiliaria_principal_id = coalesce(excluded.imobiliaria_principal_id, erp_documentos.imobiliaria_principal_id),
    canal_venda = excluded.canal_venda, numero_apolice = coalesce(excluded.numero_apolice, erp_documentos.numero_apolice),
    numero_endosso = excluded.numero_endosso, dt_proposta = excluded.dt_proposta, vigencia_inicio = excluded.vigencia_inicio,
    vigencia_fim = excluded.vigencia_fim, qtd_parcelas = excluded.qtd_parcelas, premio_liquido = excluded.premio_liquido,
    premio_adicional = excluded.premio_adicional, premio_total = excluded.premio_total, comissao_pct = excluded.comissao_pct,
    comissao_valor = excluded.comissao_valor, situacao = excluded.situacao, cancelado_em = excluded.cancelado_em,
    competencia = excluded.competencia, fora_regra_pbi = excluded.fora_regra_pbi, origem_ref = excluded.origem_ref
  where erp_documentos.origem = 'corp_import' and not erp_documentos.congelado;
  get diagnostics v_docs = row_count;

  delete from erp_documento_produtores dp using erp_documentos d
   where dp.documento_id = d.id and d.origem = 'corp_import' and d.nosso_numero_corp in (select nosso_numero from _linha);
  with imob as (
    select split_part(rf.chave_externa, '#', 1)::int as codigo, (array_agg(rf.imobiliaria_id))[1] as imobiliaria_id
    from imobiliaria_registros_fonte rf
    where rf.fonte = 'corp_produtor' and rf.imobiliaria_id is not null and split_part(rf.chave_externa, '#', 1) ~ '^\d+$'
    group by 1
  )
  insert into erp_documento_produtores (documento_id, imobiliaria_id, produtor_corp_codigo, produtor_corp_nome, agente, principal,
    pct_participacao, repasse_base, repasse_pct, repasse_valor_previsto, forma_repasse)
  select d.id, i.imobiliaria_id, l.codigo_produtor, l.produtor,
    case when l.produtor ~* '^O2 CORRETORA' then 'o2'
         when l.produtor ~* '^(SEGIMOB$|BASE SOFTWARE$|SUPERL[OÓ]GICA$)' then 'canal'
         when l.produtor ~* '^(RETRANSMISS|TOMBAMENTO$|\d+ - )' then 'marcador'
         when l.agente = 'IMOB' then 'imob'
         when l.agente = 'PARC' then 'parceiro'
         else 'pessoa' end,
    l.rn = 1, 100, 'premio_liquido', coalesce(l.pct_com_prod, 0), coalesce(l.vl_com_prod, 0), 'parcelado'
  from _linha l
  join erp_documentos d on d.nosso_numero_corp = l.nosso_numero and d.origem = 'corp_import'
  left join imob i on i.codigo = l.codigo_produtor;
  get diagnostics v_prods = row_count;

  if p_gerar_parcelas then
    delete from erp_parcelas p using erp_documentos d
     where p.documento_id = d.id and p.origem = 'estimada_corp' and d.nosso_numero_corp in (select nosso_numero from _linha);
    insert into erp_parcelas (documento_id, n, vencimento, valor, origem)
    select d.id, n,
      case when s.dia_fixo_parcela is null then (d.vigencia_inicio + 30 + ((n - 1) * interval '1 month'))::date
           else (date_trunc('month', d.vigencia_inicio + 30) + ((n - 1) * interval '1 month') + ((least(s.dia_fixo_parcela, 28) - 1) * interval '1 day'))::date end,
      round(d.premio_total / d.qtd_parcelas, 2) + case when n = 1 then d.premio_total - round(d.premio_total / d.qtd_parcelas, 2) * d.qtd_parcelas else 0 end,
      'estimada_corp'
    from erp_documentos d
    left join erp_seguradoras s on s.id = d.seguradora_id
    cross join lateral generate_series(1, greatest(coalesce(d.qtd_parcelas, 1), 1)) n
    where d.origem = 'corp_import' and coalesce(d.qtd_parcelas, 0) > 0 and d.premio_total > 0
      and d.nosso_numero_corp in (select nosso_numero from _linha);
    get diagnostics v_parc = row_count;

    insert into erp_comissoes (parcela_id, tipo, base, pct, valor_previsto, previsao_recebimento)
    select p.id, 'comissao', round(d.premio_liquido / d.qtd_parcelas, 2), d.comissao_pct,
      round(d.comissao_valor / d.qtd_parcelas, 2) + case when p.n = 1 then d.comissao_valor - round(d.comissao_valor / d.qtd_parcelas, 2) * d.qtd_parcelas else 0 end,
      p.vencimento + 7
    from erp_parcelas p join erp_documentos d on d.id = p.documento_id
    where p.origem = 'estimada_corp' and d.origem = 'corp_import'
      and d.nosso_numero_corp in (select nosso_numero from _linha)
      and not exists (select 1 from erp_comissoes c where c.parcela_id = p.id);
    get diagnostics v_com = row_count;
  end if;

  insert into erp_chaves_externas (sistema, entidade, entidade_id, chave)
  select 'corp', 'documento', d.id, d.nosso_numero_corp::text from erp_documentos d
  where d.nosso_numero_corp in (select nosso_numero from _linha)
  on conflict (sistema, entidade, chave) do nothing;

  alter table erp_documentos enable trigger erp_documentos_aud;
  alter table erp_documento_produtores enable trigger erp_documento_produtores_aud;
  alter table erp_parcelas enable trigger erp_parcelas_aud;
  alter table erp_comissoes enable trigger erp_comissoes_aud;

  return jsonb_build_object('de', p_desde, 'ate', p_ate, 'documentos', v_docs, 'produtores', v_prods, 'parcelas', v_parc, 'comissoes', v_com);
end $$;

-- Regras ESPERADAS de repasse (ficha da imobiliária), inferidas do valor mais frequente nos documentos desde 2025,
-- e marcação do esperado em cada produtor de documento (esperado × negociado). Rodar depois de todas as fatias.
create or replace function erp_inferir_regras_repasse() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_regras int; v_docs int;
begin
  alter table erp_repasse_regras disable trigger erp_repasse_regras_aud;
  insert into erp_repasse_regras (imobiliaria_id, seguradora_id, ramo_id, base_calculo, pct_novo, pct_renovado, origem, observacao)
  select x.imobiliaria_id, x.seguradora_id, x.ramo_id, 'premio_liquido', x.pct_novo, coalesce(y.pct_renovado, 0), 'corp_import',
         'Inferida do espelho do Corp em ' || to_char(now(), 'DD/MM/YYYY') || ' (valor mais frequente nos documentos desde 2025). Conferir e editar na ficha.'
  from (
    select dp.imobiliaria_id, d.seguradora_id, d.ramo_id, mode() within group (order by dp.repasse_pct) as pct_novo
    from erp_documento_produtores dp join erp_documentos d on d.id = dp.documento_id
    where dp.imobiliaria_id is not null and d.tipo_corp = 'NOVO' and d.vigencia_inicio >= '2025-01-01' and d.origem = 'corp_import'
    group by 1, 2, 3 having count(*) >= 3
  ) x
  left join (
    select dp.imobiliaria_id, d.seguradora_id, d.ramo_id, mode() within group (order by dp.repasse_pct) as pct_renovado
    from erp_documento_produtores dp join erp_documentos d on d.id = dp.documento_id
    where dp.imobiliaria_id is not null and d.tipo_corp = 'RENV' and d.vigencia_inicio >= '2025-01-01' and d.origem = 'corp_import'
    group by 1, 2, 3
  ) y on y.imobiliaria_id = x.imobiliaria_id and y.seguradora_id = x.seguradora_id and y.ramo_id = x.ramo_id
  where not exists (select 1 from erp_repasse_regras r where r.imobiliaria_id = x.imobiliaria_id
                    and r.seguradora_id is not distinct from x.seguradora_id and r.ramo_id is not distinct from x.ramo_id);
  get diagnostics v_regras = row_count;
  alter table erp_repasse_regras enable trigger erp_repasse_regras_aud;

  alter table erp_documento_produtores disable trigger erp_documento_produtores_aud;
  update erp_documento_produtores dp
     set repasse_pct_esperado = (
       select case when d.tipo_corp = 'RENV' then rr.pct_renovado else rr.pct_novo end
       from erp_repasse_regras rr
       where rr.imobiliaria_id = dp.imobiliaria_id and rr.vigente_ate is null
         and (rr.seguradora_id = d.seguradora_id or rr.seguradora_id is null)
         and (rr.ramo_id = d.ramo_id or rr.ramo_id is null)
       order by (rr.seguradora_id is not null)::int + (rr.ramo_id is not null)::int desc
       limit 1)
  from erp_documentos d
  where d.id = dp.documento_id and dp.imobiliaria_id is not null and dp.repasse_pct_esperado is null and d.vigencia_inicio >= '2025-01-01';
  get diagnostics v_docs = row_count;
  alter table erp_documento_produtores enable trigger erp_documento_produtores_aud;

  perform erp_atualizar_retrato();
  return jsonb_build_object('regras', v_regras, 'produtores_marcados', v_docs);
end $$;
