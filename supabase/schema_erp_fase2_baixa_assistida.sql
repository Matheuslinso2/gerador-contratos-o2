-- ERP O2 — Fase 2 (25/10/2026): BAIXA DE COMISSÃO ASSISTIDA (Fase 1 do "robô de baixa"). Nada é escrito no Corp.
-- Aplicado via MCP apply_migration: erp_fase2_baixa_assistida.
--
-- Fluxo:
--   1. o extrato chega (e-mail ou pasta do Drive) → erp_cruzar_extratos() casa linha → documento → parcela
--      e chama erp_conferir_extratos(), que classifica cada linha como no Corp:
--        cheia            recebido = prêmio da linha × % de comissão do documento (±0,5%, mín. 5 centavos)
--        pro_labore_direto % doc − % recebido = pró-labore da imob × seguradora (erp_repasse_direto_seguradora, ±1 ponto)
--        estorno          valor negativo (endosso de cancelamento/restituição) → tratar no Corp
--        divergente       o resto (inclui endosso positivo, % pago diferente do documento)
--        nao_encontrada   sem documento, sem parcela ou sem comissão prevista no ERP
--      Antes (até 25/10 à tarde) o cruzamento já gravava erp_comissao_recebimentos sozinho; agora o recebimento
--      só nasce na APROVAÇÃO (os 300 recebimentos automáticos foram apagados e voltam ao aprovar).
--   2. /erp/baixas: resumo por corretora × seguradora × mês (view erp_baixa_assistida_mensal) e por extrato
--      (erp_baixa_assistida_resumo): linhas por classificação, soma das linhas × total do extrato ("conta fecha"),
--      bruto − imposto (erp_imposto_retido) − desconto (erp_descontos_comissao, por mês) = líquido esperado.
--   3. "Aprovar baixa" (server action → erp_aprovar_baixa_extrato, só colaborador O2): grava recebimento origem 'extrato'
--      das linhas cheia/pró-labore, marca erp_parcelas.quitada_em e erp_comissoes.status = 'recebida', registra quem e quando.
--      Estorno/divergente/não encontrada ficam "para tratar" (tratar_motivo / tratar_resolvido_em).
--   4. Lista pronta para o Corp: view erp_baixa_assistida_lista_corp (Seguradora → Nosso Nº → Parcela), exportada em CSV
--      por /erp/baixas/lista-corp; coluna "já baixada no Corp" evita lançar de novo.
--   5. Lugar do Nibo: erp_extratos_seguradora.entrou_banco_em / entrou_banco_valor / entrou_banco_ref (vazio até a integração).

alter table erp_extrato_linhas
  add column if not exists conferencia text check (conferencia in ('cheia','pro_labore_direto','estorno','divergente','nao_encontrada')),
  add column if not exists pct_doc numeric,
  add column if not exists pct_recebido numeric,
  add column if not exists valor_esperado numeric,
  add column if not exists pct_pro_labore numeric,
  add column if not exists valor_falta numeric,
  add column if not exists motivo_auto text,
  add column if not exists ja_baixada_corp boolean not null default false,
  add column if not exists conferido_em timestamptz,
  add column if not exists tratar_motivo text,
  add column if not exists tratar_resolvido_em timestamptz,
  add column if not exists tratar_por_email text;

alter table erp_extratos_seguradora
  add column if not exists baixa_aprovada_em timestamptz,
  add column if not exists baixa_aprovada_por uuid,
  add column if not exists baixa_aprovada_por_email text,
  add column if not exists entrou_banco_em date,
  add column if not exists entrou_banco_valor numeric,
  add column if not exists entrou_banco_ref text;

-- Classificação das linhas (todas ou só de um extrato). Linhas de extrato já aprovado não mudam.
create or replace function erp_conferir_extratos(p_extrato uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  with alvo as (
    select l.id, l.valor_comissao, l.premio, l.pct_comissao, l.tipo, l.documento_id, l.parcela_id,
           c.id as comissao_id, c.pct as pct_doc, coalesce(nullif(l.premio, 0), c.base) as base,
           (select r.pct from erp_repasse_direto_seguradora r join erp_documentos d on d.imobiliaria_principal_id = r.imobiliaria_id and d.seguradora_id = r.seguradora_id
             where d.id = l.documento_id order by r.confirmado desc, r.created_at desc limit 1) as pct_pl,
           exists (select 1 from erp_corp_comissoes cc where cc.parcela_id = l.parcela_id and cc.situacao = 'recebida') as no_corp
    from erp_extrato_linhas l
    join erp_extratos_seguradora e on e.id = l.extrato_id
    left join erp_comissoes c on c.parcela_id = l.parcela_id and c.tipo = 'comissao'
    where e.baixa_aprovada_em is null and (p_extrato is null or l.extrato_id = p_extrato)
  ), calc as (
    select a.*, round(a.base * a.pct_doc / 100, 2) as esperado,
           coalesce(a.pct_comissao, case when a.base <> 0 then round(a.valor_comissao / a.base * 100, 2) end) as pct_rec
    from alvo a
  )
  update erp_extrato_linhas l set
    pct_doc = c.pct_doc, pct_recebido = c.pct_rec, valor_esperado = c.esperado, pct_pro_labore = c.pct_pl,
    valor_falta = case when c.esperado is not null then round(c.esperado - c.valor_comissao, 2) end,
    ja_baixada_corp = c.no_corp, conferido_em = now(),
    conferencia = case
      when c.documento_id is null then 'nao_encontrada'
      when c.parcela_id is null or c.comissao_id is null then 'nao_encontrada'
      when c.valor_comissao < 0 then 'estorno'
      when c.tipo ilike '%endosso%' then 'divergente'
      when c.pct_doc is null or c.base is null or c.base = 0 then 'divergente'
      when abs(c.esperado - c.valor_comissao) <= greatest(0.05, abs(c.base) * 0.005) then 'cheia'
      when c.pct_pl is not null and c.pct_rec is not null and abs((c.pct_doc - c.pct_rec) - c.pct_pl) <= 1 then 'pro_labore_direto'
      else 'divergente' end,
    motivo_auto = case
      when c.documento_id is null then 'apólice não encontrada no ERP'
      when c.parcela_id is null then 'parcela ' || coalesce(l.parcela::text, '?') || ' não existe no documento'
      when c.comissao_id is null then 'parcela sem comissão prevista'
      when c.valor_comissao < 0 then 'estorno (valor negativo) — lançar restituição no Corp'
      when c.tipo ilike '%endosso%' then 'endosso — conferir no Corp'
      when c.pct_doc is null or c.base is null or c.base = 0 then 'documento sem % ou base de comissão'
      when abs(c.esperado - c.valor_comissao) <= greatest(0.05, abs(c.base) * 0.005) then null
      when c.pct_pl is not null and c.pct_rec is not null and abs((c.pct_doc - c.pct_rec) - c.pct_pl) <= 1 then null
      else 'pago ' || coalesce(trim_scale(c.pct_rec)::text, '?') || '% e o documento diz ' || trim_scale(c.pct_doc)::text || '%' end
  from calc c where l.id = c.id;
  get diagnostics v = row_count;
  return v;
end $$;

-- O cruzamento deixa de gravar recebimento sozinho (agora é a aprovação) e passa a classificar.
create or replace function erp_cruzar_extratos()
returns table(linhas_casadas integer, parcelas_casadas integer, recebimentos integer, marcados_boleto integer, marcados_nao_administrado integer)
language plpgsql security definer set search_path to 'public' as $function$
declare v_l int; v_p int; v_r int; v_b int; v_n int;
begin
  update erp_extrato_linhas l set documento_id = x.doc, casado_em = now()
  from (
    select l2.id as linha, (
      select d.id from erp_documentos d
      where d.seguradora_id = e.seguradora_id and d.tipo = 'A' and d.numero_apolice is not null
        and (erp_digitos_apolice(d.numero_apolice) = erp_digitos_apolice(l2.apolice)
             or (length(erp_digitos_apolice(d.numero_apolice)) >= 7 and erp_digitos_apolice(l2.apolice) like '%' || erp_digitos_apolice(d.numero_apolice) || '%'))
      order by (erp_digitos_apolice(d.numero_apolice) = erp_digitos_apolice(l2.apolice)) desc, (d.situacao in ('vigente','emitido')) desc, d.vigencia_inicio desc nulls last
      limit 1) as doc
    from erp_extrato_linhas l2 join erp_extratos_seguradora e on e.id = l2.extrato_id
    where l2.documento_id is null and erp_digitos_apolice(l2.apolice) is not null
  ) x
  where l.id = x.linha and x.doc is not null;
  get diagnostics v_l = row_count;
  update erp_extrato_linhas l set documento_id = d.id, casado_em = now()
  from erp_extratos_seguradora e, erp_documentos d
  where e.id = l.extrato_id and l.documento_id is null and l.proposta is not null
    and d.seguradora_id = e.seguradora_id and d.numero_proposta is not null
    and erp_digitos_apolice(d.numero_proposta) = erp_digitos_apolice(l.proposta);
  update erp_extrato_linhas l set parcela_id = p.id
  from erp_parcelas p
  where l.parcela_id is null and l.documento_id is not null and l.parcela is not null and p.documento_id = l.documento_id and p.n = l.parcela;
  get diagnostics v_p = row_count;
  v_r := erp_conferir_extratos(null);
  update erp_documentos d set modo_cobranca = 'boleto'
  where d.modo_cobranca in ('nao_informado','individual')
    and exists (select 1 from erp_extrato_linhas l where l.documento_id = d.id)
    and not exists (select 1 from erp_fatura_apolices_observadas o where o.documento_id = d.id)
    and exists (select 1 from faturas_esperadas fe join erp_seguradoras s on s.id = d.seguradora_id
                where fe.imobiliaria_id = d.imobiliaria_principal_id and fe.ativo
                  and fe.seguradora = case s.abreviacao when 'TOKI' then 'TOKIO' when 'POTT' then 'POTTENCIAL' when 'TOO' then 'TOO' when 'YELU' then 'YELUM' else s.abreviacao end)
    and exists (select 1 from faturas f join erp_seguradoras s on s.id = d.seguradora_id
                where f.imobiliaria_id = d.imobiliaria_principal_id and f.arquivo_nome ilike '%relat%' and f.texto_bruto_extraido is not null and f.status <> 'cancelada'
                  and f.seguradora = case s.abreviacao when 'TOKI' then 'TOKIO' when 'POTT' then 'POTTENCIAL' when 'TOO' then 'TOO' when 'YELU' then 'YELUM' else s.abreviacao end);
  get diagnostics v_b = row_count;
  select marcados_nao into v_n from erp_inferir_administrado();
  perform erp_atualizar_fora_faturas();
  -- "recebimentos" agora = linhas classificadas nesta rodada (o recebimento nasce na aprovação da baixa)
  return query select v_l, v_p, v_r, v_b, v_n;
end $function$;

-- Recebimentos gravados automaticamente pelo cruzamento antigo (nunca aprovados): saem e voltam na aprovação.
delete from erp_comissao_recebimentos r
where r.origem = 'extrato' and r.extrato_linha_id is not null
  and exists (select 1 from erp_extratos_seguradora e where e.id = r.extrato_id and e.baixa_aprovada_em is null);

-- Resumo por extrato
create or replace view erp_baixa_assistida_resumo with (security_invoker = true) as
select e.id, e.seguradora_id, s.nome as seguradora, s.abreviacao as seg_abrev, e.corretora_id, co.apelido as corretora,
       date_trunc('month', e.competencia)::date as mes, e.competencia, e.tipo, e.origem, e.leitura, e.arquivo_path, e.created_at,
       e.total_bruto as total_extrato,
       coalesce(l.soma, 0) as soma_linhas,
       coalesce(l.linhas, 0) as linhas,
       (e.total_bruto is not null and abs(coalesce(l.soma, 0) - e.total_bruto) < 0.01) as conta_fecha,
       coalesce(l.n_cheia, 0) as n_cheia, coalesce(l.n_pro_labore, 0) as n_pro_labore, coalesce(l.n_estorno, 0) as n_estorno,
       coalesce(l.n_divergente, 0) as n_divergente, coalesce(l.n_nao_encontrada, 0) as n_nao_encontrada,
       coalesce(l.v_cheia, 0) as valor_cheia, coalesce(l.v_pro_labore, 0) as valor_pro_labore, coalesce(l.v_tratar, 0) as valor_tratar,
       coalesce(l.v_cheia, 0) + coalesce(l.v_pro_labore, 0) as valor_a_baixar,
       coalesce(l.pro_labore_falta, 0) as pro_labore_pago_direto,
       coalesce(l.n_ja_corp, 0) as ja_baixadas_corp,
       coalesce(l.n_tratar_aberto, 0) as tratar_em_aberto,
       coalesce(i.pct, 0) as imposto_pct,
       round(coalesce(e.total_bruto, l.soma, 0) * coalesce(i.pct, 0) / 100, 2) as imposto,
       round(coalesce(e.total_bruto, l.soma, 0) * (1 - coalesce(i.pct, 0) / 100), 2) as liquido_sem_desconto,
       e.baixa_aprovada_em, e.baixa_aprovada_por_email,
       e.entrou_banco_em, e.entrou_banco_valor, e.entrou_banco_ref
from erp_extratos_seguradora e
left join erp_seguradoras s on s.id = e.seguradora_id
left join erp_corretoras co on co.id = e.corretora_id
left join erp_imposto_retido i on i.corretora_id = e.corretora_id and i.seguradora_abrev = s.abreviacao
left join lateral (
  select count(*) as linhas, round(sum(x.valor_comissao), 2) as soma,
         count(*) filter (where x.conferencia = 'cheia') as n_cheia,
         count(*) filter (where x.conferencia = 'pro_labore_direto') as n_pro_labore,
         count(*) filter (where x.conferencia = 'estorno') as n_estorno,
         count(*) filter (where x.conferencia = 'divergente') as n_divergente,
         count(*) filter (where x.conferencia = 'nao_encontrada') as n_nao_encontrada,
         round(sum(x.valor_comissao) filter (where x.conferencia = 'cheia'), 2) as v_cheia,
         round(sum(x.valor_comissao) filter (where x.conferencia = 'pro_labore_direto'), 2) as v_pro_labore,
         round(sum(x.valor_comissao) filter (where x.conferencia in ('estorno','divergente','nao_encontrada')), 2) as v_tratar,
         round(sum(x.valor_falta) filter (where x.conferencia = 'pro_labore_direto'), 2) as pro_labore_falta,
         count(*) filter (where x.ja_baixada_corp) as n_ja_corp,
         count(*) filter (where x.conferencia in ('estorno','divergente','nao_encontrada') and x.tratar_resolvido_em is null) as n_tratar_aberto
  from erp_extrato_linhas x where x.extrato_id = e.id
) l on true;

-- Resumo por corretora × seguradora × mês (o desconto da seguradora, ex. empréstimo Porto, é do mês)
create or replace view erp_baixa_assistida_mensal with (security_invoker = true) as
select r.mes, r.corretora_id, r.corretora, r.seguradora_id, r.seguradora, r.seg_abrev,
       count(*) as extratos,
       count(*) filter (where r.baixa_aprovada_em is not null) as aprovados,
       count(*) filter (where r.tipo = 'resumo_mensal') as so_total,
       sum(r.linhas) as linhas, sum(r.n_cheia) as n_cheia, sum(r.n_pro_labore) as n_pro_labore,
       sum(r.n_estorno) as n_estorno, sum(r.n_divergente) as n_divergente, sum(r.n_nao_encontrada) as n_nao_encontrada,
       round(sum(coalesce(r.total_extrato, r.soma_linhas)), 2) as bruto,
       max(r.imposto_pct) as imposto_pct,
       round(sum(r.imposto), 2) as imposto,
       coalesce((select sum(d.valor) from erp_descontos_comissao d where d.seguradora_id = r.seguradora_id and d.corretora_id = r.corretora_id and d.competencia = r.mes), 0) as desconto,
       round(sum(r.liquido_sem_desconto), 2)
         - coalesce((select sum(d.valor) from erp_descontos_comissao d where d.seguradora_id = r.seguradora_id and d.corretora_id = r.corretora_id and d.competencia = r.mes), 0) as liquido_esperado,
       round(sum(r.valor_a_baixar), 2) as valor_a_baixar,
       round(sum(r.pro_labore_pago_direto), 2) as pro_labore_pago_direto,
       bool_and(r.conta_fecha or r.tipo = 'resumo_mensal') as conta_fecha,
       sum(r.entrou_banco_valor) as entrou_banco_valor,
       max(r.entrou_banco_em) as entrou_banco_em
from erp_baixa_assistida_resumo r
group by r.mes, r.corretora_id, r.corretora, r.seguradora_id, r.seguradora, r.seg_abrev;

-- Lista pronta para o financeiro lançar no Corp (só linhas de extrato aprovado, cheia/pró-labore)
create or replace view erp_baixa_assistida_lista_corp with (security_invoker = true) as
select e.id as extrato_id, co.apelido as corretora, s.nome as seguradora, s.abreviacao as seg_abrev,
       date_trunc('month', e.competencia)::date as mes,
       d.nosso_numero_corp, d.nosso_numero as codigo_o2, coalesce(d.numero_apolice, l.apolice) as apolice, l.apolice as apolice_extrato,
       l.parcela, l.cliente, l.premio, l.pct_doc, l.pct_recebido, l.valor_comissao as valor_baixar,
       l.conferencia, l.ja_baixada_corp, e.baixa_aprovada_em, e.baixa_aprovada_por_email, e.arquivo_path
from erp_extrato_linhas l
join erp_extratos_seguradora e on e.id = l.extrato_id
left join erp_seguradoras s on s.id = e.seguradora_id
left join erp_corretoras co on co.id = e.corretora_id
left join erp_documentos d on d.id = l.documento_id
where e.baixa_aprovada_em is not null and l.conferencia in ('cheia','pro_labore_direto');

-- Aprovação (só colaborador O2). Reconfere o extrato, grava recebimentos e quita parcelas.
create or replace function erp_aprovar_baixa_extrato(p_extrato uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_email text := auth.jwt() ->> 'email'; v_rec int; v_parc int; v_tratar int; v_tipo text; v_aprov timestamptz;
begin
  if not (select is_colaborador_o2()) then raise exception 'sem permissão'; end if;
  select tipo, baixa_aprovada_em into v_tipo, v_aprov from erp_extratos_seguradora where id = p_extrato for update;
  if not found then raise exception 'extrato não encontrado'; end if;
  if v_aprov is not null then raise exception 'baixa deste extrato já foi aprovada em %', to_char(v_aprov at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'); end if;
  if v_tipo = 'resumo_mensal' then raise exception 'extrato só com o total do mês: não tem apólices para baixar'; end if;
  perform erp_conferir_extratos(p_extrato);

  insert into erp_comissao_recebimentos (comissao_id, recebido_em, valor_recebido, origem, extrato_id, extrato_linha, extrato_linha_id, diferenca, conferido_por_email, observacao)
  select c.id, coalesce(e.pago_em, e.competencia, l.created_at::date), l.valor_comissao, 'extrato', l.extrato_id, l.n, l.id,
         l.valor_comissao - c.valor_previsto, v_email,
         case when l.conferencia = 'pro_labore_direto' then 'baixa assistida — pró-labore de ' || l.pct_pro_labore || '% pago direto à imobiliária' else 'baixa assistida' end
  from erp_extrato_linhas l join erp_extratos_seguradora e on e.id = l.extrato_id
  join erp_comissoes c on c.parcela_id = l.parcela_id and c.tipo = 'comissao'
  where l.extrato_id = p_extrato and l.conferencia in ('cheia','pro_labore_direto')
    and not exists (select 1 from erp_comissao_recebimentos r where r.extrato_linha_id = l.id);
  get diagnostics v_rec = row_count;

  update erp_parcelas p set quitada_em = coalesce(p.quitada_em, coalesce(e.pago_em, e.competencia)), valor_quitado = coalesce(p.valor_quitado, l.premio)
  from erp_extrato_linhas l join erp_extratos_seguradora e on e.id = l.extrato_id
  where l.extrato_id = p_extrato and l.conferencia in ('cheia','pro_labore_direto') and p.id = l.parcela_id;
  get diagnostics v_parc = row_count;

  update erp_comissoes c set status = 'recebida'
  from erp_extrato_linhas l
  where l.extrato_id = p_extrato and l.conferencia in ('cheia','pro_labore_direto') and c.parcela_id = l.parcela_id and c.tipo = 'comissao' and c.status = 'prevista';

  select count(*) into v_tratar from erp_extrato_linhas where extrato_id = p_extrato and conferencia in ('estorno','divergente','nao_encontrada');

  update erp_extratos_seguradora set baixa_aprovada_em = now(), baixa_aprovada_por = auth.uid(), baixa_aprovada_por_email = v_email, conciliado_em = coalesce(conciliado_em, now())
  where id = p_extrato;

  return json_build_object('recebimentos', v_rec, 'parcelas_quitadas', v_parc, 'para_tratar', v_tratar);
end $$;
revoke all on function erp_aprovar_baixa_extrato(uuid) from public, anon;
grant execute on function erp_aprovar_baixa_extrato(uuid) to authenticated;
revoke all on function erp_conferir_extratos(uuid) from public, anon, authenticated;

grant select on erp_baixa_assistida_resumo, erp_baixa_assistida_mensal, erp_baixa_assistida_lista_corp to authenticated;

select erp_conferir_extratos(null);

-- ---------------------------------------------------------------------------
-- Migration erp_fase2_baixa_assistida_datas (mesmo dia, depois de ler os manuais BAIXA DE COMISSÃO e REPASSE AO PRODUTOR):
-- no Corp a baixa é pelo valor BRUTO e leva "data de recebimento" + "previsão de repasse = dia 15 do mês seguinte".
--   erp_extrato_data_recebimento(pago_em, arquivo, criado): pago_em → data AAAAMMDD do nome do arquivo (relatórios são
--     nomeados pela data de recebimento) → data de chegada do extrato.
--   erp_baixa_assistida_lista_corp ganhou data_recebimento e previsao_repasse; erp_aprovar_baixa_extrato grava o
--   recebimento e a quitação da parcela com essa data (e devolve data_recebimento no json).
-- (corpo completo das funções na migration; mesma lógica de cima com v_data no lugar de coalesce(pago_em, competencia))

-- ---------------------------------------------------------------------------
-- Migration erp_fase2_baixa_assistida_incorp (mesmo dia, manual oficial "BAIXA DE COMISSÃO" + mapeamento do Corp):
-- o Corp tem importador de extrato (Aplicativos → InCorp → Comissões: linhas brancas = apólice, laranjas = endosso → aptas;
-- amarelas = pendência de cadastro/emissão). Tokio/Porto/Pottencial/Too são baixadas pelo InCorp, as demais à mão.
-- A baixa no Corp é pelo BRUTO e tem de bater com o bruto do extrato → a lista para o Corp passou a levar tudo menos as
-- 'nao_encontrada' (= amarelas): cheia, pró-labore, estorno/endosso e divergente (marcado para conferir), com motivo_auto e
-- como_lancar ('INCORP (arquivo original do extrato)' | 'manual (Consulta de Documentos)'). O recebimento no ERP continua
-- só para cheia/pró-labore. Tela: aviso "quando baixar" (Pottencial ≥ dia 26 ou pagamento confirmado; Too após NF + dinheiro).
-- Repasse (manual REPASSE AO PRODUTOR): até o fim do mês seguinte ao recebimento; documento com pró-labore pago direto
-- (erp_repasse_direto_seguradora) NÃO gera repasse da O2 — vale para a fase de repasses.

-- ---------------------------------------------------------------------------
-- 25/10 (noite) — EXTRATOS DA TOKIO E DA PORTO PELA PASTA OFICIAL, COM LEITOR FIXO (sem IA)
-- src/lib/erp/extratosPdf.ts: parseTokioPdf ("Extrato do Corretor": Segurado|Negócio|Ramo|Apólice|Endosso|Tipo|Parc|Prêmio|%|R$;
--   cabeçalho = data de crédito + bruto + líquido) e parsePortoPdf ("Analítico de Pagamentos de Comissões"; a coluna Marca sai
--   grudada no fim do Tipo; venda avulsa de cartão sem Apl/Prop; rodapé Bruta|INSS|IRRF|ISS|Líquido|Débito/Crédito|A pagar —
--   o "A pagar" já vem com o desconto do empréstimo, ex. 19/08: bruto 22.605,02 → a pagar 426,54). Ligado em extratosDrive.ts
--   antes da IA. Agosto/26: 37/37 arquivos fecham ao centavo (1.668 linhas). Set/out da Tokio e da Porto NÃO estão na pasta.
-- Migrations: erp_fase2_extratos_tokio_porto_pdf (resumo mensal não soma o total por e-mail da Tokio quando já há extrato por
--   apólice do mesmo mês × corretora), erp_fase2_cruzar_extratos_indices (casamento por índice: igual / nº do Corp termina com o
--   do extrato [Porto 1718624076712 × 24076712] / nº do extrato termina com o do Corp [Pottencial]; índices
--   erp_documentos_apolice_dig_idx e _rev_idx — o casamento antigo por LIKE estourava o tempo com 1.668 linhas),
--   erp_fase2_corp_comissoes_parcela_idx (ja_baixada_corp por índice), erp_fase2_conferir_extratos_incremental (cron reclassifica
--   só linhas novas/recasadas ou conferidas há > 6 h; aprovar reconfere o extrato inteiro), erp_fase2_conferir_sugere_pro_labore
--   (divergente com falta exata de 3/5/10/15/20/25/30 pontos e sem regra → "parece pró-labore … cadastrar na ficha da imob"),
--   erp_fase2_baixa_resumo_arquivo_nome (caminho legível do arquivo do Drive).
-- Resultado: 1.646/1.668 casadas; Tokio 333 cheias, 38 pró-labore conferido, 49 divergentes (36 "parece pró-labore"), 49 estornos;
--   Porto 897 cheias, 7 pró-labore, 266 divergentes (70 "parece pró-labore"), 6 estornos, 23 não encontradas. Quase tudo de
--   agosto já estava baixado no Corp. erp_cruzar_extratos inteiro ≈ 2,7 s; resumo mensal 5 ms.
-- Tela /erp/baixas: linhas carregadas só do extrato aberto (?extrato=) e só as "para tratar" em aberto; RascunhoAutomatico no motivo.

-- 25/10 (noite) — filtros padronizados na /erp/baixas (premissa 5 do ERP, componente FiltrosErp): busca (apólice / Nosso Nº /
-- cliente), seguradora, corretora, imobiliária (base única, pelo documento casado), período = data de recebimento e situação
-- (extrato a aprovar/aprovado ou classificação da linha). Migration erp_fase2_baixa_resumo_data_recebimento: coluna
-- data_recebimento no erp_baixa_assistida_resumo. Filtros de linha mostram a seção "Linhas encontradas" (até 300).
