-- ERP O2 (28/10/2026): comissão que DEVERIA CAIR em cada mês, conforme a experiência de cada seguradora.
-- Aplicado via MCP (migration erp_previsao_caixa_mensal). Só leitura.
-- Data esperada = vencimento da parcela + prazo mediano (seguradora × ramo; senão só seguradora) das comissões recebidas nos
-- últimos 16 meses; fim de semana cai na segunda. Líquido = bruto − imposto retido da empresa (erp_imposto_retido).
-- Limite conhecido: Tokio e Yelum ficam acima do caixa (pró-labore pago direto à imobiliária ainda não descontado).
create or replace function erp_previsao_caixa_mensal(p_de date, p_ate date)
returns table (corretora text, seg_abrev text, mes text, parcelas bigint, previsto_bruto numeric, previsto_liquido numeric, venc_liquido numeric)
language sql stable
as $$
with base as (
  select (case when c.seg_abrev = 'ALF' then 'ALFA' else c.seg_abrev end) as seg, c.ramo, (c.data - c.venc_parcela) as lag
  from erp_corp_comissoes c
  where c.situacao = 'recebida' and c.venc_parcela is not null
    and c.data >= (current_date - 480) and c.data <= current_date
    and c.ramo is distinct from 'PREM' and c.cancelado is distinct from 'Sim'
),
l1 as (select seg, ramo, percentile_cont(0.5) within group (order by lag) as med from base group by 1, 2 having count(*) >= 30),
l2 as (select seg, percentile_cont(0.5) within group (order by lag) as med from base group by 1 having count(*) >= 30),
p as (
  select c.corretora,
    (case when c.seg_abrev = 'ALF' then 'ALFA' else c.seg_abrev end) as seg,
    c.valor, (1 - coalesce(ir.pct, 0) / 100.0) as fator, c.venc_parcela as vence,
    c.venc_parcela + round(coalesce(l1.med, l2.med, 0))::int as esp
  from erp_corp_comissoes c
  left join erp_corretoras co on co.apelido = c.corretora
  left join erp_imposto_retido ir on ir.corretora_id = co.id and ir.seguradora_abrev = (case when c.seg_abrev = 'ALF' then 'ALFA' else c.seg_abrev end)
  left join l1 on l1.seg = (case when c.seg_abrev = 'ALF' then 'ALFA' else c.seg_abrev end) and l1.ramo is not distinct from c.ramo
  left join l2 on l2.seg = (case when c.seg_abrev = 'ALF' then 'ALFA' else c.seg_abrev end)
  where c.ramo is distinct from 'PREM' and c.cancelado is distinct from 'Sim'
    and c.venc_parcela between (p_de - 150) and (p_ate + 60)
),
q as (
  select corretora, seg, valor, fator, vence,
    (case extract(dow from esp) when 6 then esp + 2 when 0 then esp + 1 else esp end) as esp2
  from p
),
a as (
  select corretora, seg, to_char(esp2, 'YYYY-MM') as mes, count(*) as parcelas, sum(valor) as bruto, sum(valor * fator) as liq
  from q where esp2 between p_de and p_ate group by 1, 2, 3
),
v as (
  select corretora, seg, to_char(vence, 'YYYY-MM') as mes, sum(valor * fator) as liq
  from q where vence between p_de and p_ate group by 1, 2, 3
)
select coalesce(a.corretora, v.corretora), coalesce(a.seg, v.seg), coalesce(a.mes, v.mes),
  coalesce(a.parcelas, 0), round(coalesce(a.bruto, 0), 2), round(coalesce(a.liq, 0), 2), round(coalesce(v.liq, 0), 2)
from a full join v on a.corretora = v.corretora and a.seg = v.seg and a.mes = v.mes
$$;
