-- ERP · Repasses · Fase 1 (SÓ LEITURA, aditiva). Simula o repasse de um mês sem gravar nada.
-- Regra (Matheus 26-29/10): comissão RECEBIDA de 1 a 30/31 do mês M → repasse do mês M+1 (previsão dia 15).
-- Linha = base da parcela (base_com, prêmio) × % de repasse do documento × % de participação. Vale o % que está no
-- documento para qualquer tipo (novo, renovação, endosso): nada é bloqueado por tipo (decide-se depois quem recebe).
-- Venda sem imobiliária fica de fora. Uma linha por parcela recebida × imobiliária do documento (principal primeiro).
create or replace function erp_repasse_simulado(p_mes_repasse date)
returns table (
  imobiliaria_id uuid, imobiliaria text, comissao_id bigint, documento_id uuid, segurado text, seg_abrev text, ramo text,
  apolice text, tipo_documento text, parcela text, recebida_em date, previsao date,
  pct_part numeric, base numeric, pct_rep numeric, repasse numeric, conferencia text, pro_labore_direto boolean
) language sql stable as $$
  select dp.imobiliaria_id, i.nome, c.id, c.documento_id, c.cliente, c.seg_abrev, c.ramo, c.apolice, c.tipo_documento,
         coalesce(c.parcela_texto, c.parcela_n || '/' || c.parcelas_total), c.data,
         (date_trunc('month', p_mes_repasse) + interval '14 days')::date,
         coalesce(c.pct_part, 100), c.base_com, coalesce(dp.repasse_pct, 0),
         round(c.base_com * coalesce(dp.repasse_pct, 0) / 100 * coalesce(c.pct_part, 100) / 100, 2),
         c.conferencia,
         exists (select 1 from erp_repasse_direto_seguradora r join erp_documentos d on d.id = c.documento_id
                  where r.imobiliaria_id = dp.imobiliaria_id and r.seguradora_id = d.seguradora_id)
    from erp_corp_comissoes c
    join lateral (select distinct on (x.imobiliaria_id) x.* from erp_documento_produtores x
                   where x.documento_id = c.documento_id and x.imobiliaria_id is not null
                   order by x.imobiliaria_id, x.principal desc) dp on true
    join imobiliarias i on i.id = dp.imobiliaria_id
   where c.situacao = 'recebida'
     and c.data >= (date_trunc('month', p_mes_repasse) - interval '1 month')::date
     and c.data <  date_trunc('month', p_mes_repasse)::date
     and c.base_com is not null;
$$;

-- Segunda verificação das regras de pró-labore pago direto (view já aplicada: migration erp_repasse_direto_verificacao).
-- Compara cada regra imobiliária × seguradora com a conferência das baixas desde 01/07/2025
-- (consistente · mistura · contradiz · fraca · sem prova). Quem confirma a regra continua sendo o financeiro.
create or replace view erp_repasse_direto_verificacao as
with base as (
  select r.id regra_id, r.imobiliaria_id, r.seguradora_id, r.pct regra_pct, r.confirmado, c.conferencia, c.pct_falta, c.data, c.base_com,
         coalesce(dp.repasse_pct, 0) repasse_pct
    from erp_repasse_direto_seguradora r
    join erp_documentos d on d.seguradora_id = r.seguradora_id
    join erp_documento_produtores dp0 on dp0.documento_id = d.id and dp0.imobiliaria_id = r.imobiliaria_id
    join erp_corp_comissoes c on c.documento_id = d.id and c.situacao = 'recebida' and c.data >= '2025-07-01' and c.base_com > 0
    left join lateral (select x.repasse_pct from erp_documento_produtores x where x.documento_id = d.id and x.imobiliaria_id = r.imobiliaria_id order by x.principal desc limit 1) dp on true
   group by r.id, r.imobiliaria_id, r.seguradora_id, r.pct, r.confirmado, c.id, c.conferencia, c.pct_falta, c.data, c.base_com, dp.repasse_pct
),
v as (
  select regra_id, imobiliaria_id, seguradora_id, max(regra_pct) regra_pct, bool_or(confirmado) confirmado, count(*) linhas,
    count(*) filter (where conferencia = 'pro_labore_direto') pl,
    count(*) filter (where conferencia = 'cheia') cheia,
    count(*) filter (where conferencia = 'divergente') divergente,
    max(data) filter (where conferencia = 'pro_labore_direto') ultima_pl,
    max(data) filter (where conferencia = 'cheia' and repasse_pct > 0) ultima_cheia_com_repasse,
    count(*) filter (where repasse_pct > 0) linhas_repasse_maior_0,
    count(*) filter (where repasse_pct > 0 and conferencia = 'pro_labore_direto') pl_com_repasse,
    count(*) filter (where repasse_pct > 0 and conferencia = 'cheia') cheia_com_repasse,
    count(*) filter (where repasse_pct > 0 and conferencia = 'divergente') div_com_repasse
  from base group by 1, 2, 3
)
select v.*, i.nome imobiliaria, s.abreviacao seguradora,
  case
    when linhas is null or linhas = 0 then 'sem_prova: nenhuma baixa desde jul/25'
    when pl = 0 then 'contradiz: nenhuma baixa mostra pró-labore'
    when ultima_cheia_com_repasse is not null and ultima_cheia_com_repasse >= coalesce(ultima_pl, '1900-01-01') then 'mistura: a baixa mais recente veio cheia (decidir linha a linha)'
    when pl >= 3 then 'consistente: baixas mostram pró-labore, sem baixa cheia depois'
    else 'fraca: poucas baixas (menos de 3)'
  end verificacao
from v
join imobiliarias i on i.id = v.imobiliaria_id
join erp_seguradoras s on s.id = v.seguradora_id;
