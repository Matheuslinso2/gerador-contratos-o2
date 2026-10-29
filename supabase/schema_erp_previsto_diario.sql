-- ERP O2 (29/10/2026): comissão PREVISTA POR DIA = parcelas que vencem naquele dia (recebidas ou não), líquida do imposto retido da empresa.
-- Aplicado via MCP (migration erp_previsto_diario). Só leitura. Alimenta o gráfico COMPORTAMENTO DIÁRIO DE COMISSÕES em /erp/baixas
-- (previsto do dia x recebido no dia = Nibo). Agregado por empresa e dia: todas as seguradoras e produtos somados.
create or replace function erp_previsto_diario(p_de date, p_ate date)
returns table (corretora text, dia date, parcelas bigint, previsto_liquido numeric)
language sql stable
as $$
select c.corretora, c.venc_parcela as dia, count(*) as parcelas,
  round(sum(c.valor * (1 - coalesce(ir.pct, 0) / 100.0)), 2) as previsto_liquido
from erp_corp_comissoes c
left join erp_corretoras co on co.apelido = c.corretora
left join erp_imposto_retido ir on ir.corretora_id = co.id and ir.seguradora_abrev = (case when c.seg_abrev = 'ALF' then 'ALFA' else c.seg_abrev end)
where c.venc_parcela between p_de and p_ate and c.ramo is distinct from 'PREM' and c.cancelado is distinct from 'Sim'
group by 1, 2
$$;
