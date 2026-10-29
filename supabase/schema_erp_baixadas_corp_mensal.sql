-- ERP O2 (29/10/2026): comissão já BAIXADA no Corp em cada mês (data da quitação), por empresa e seguradora.
-- Aplicado via MCP (migration erp_baixadas_corp_mensal). Só leitura. Alimenta a coluna "Baixadas" do quadro CONTROLE MENSAL DE
-- BAIXA DE COMISSÃO em /erp/baixas. Bruto e líquido (bruto menos o imposto retido da empresa em erp_imposto_retido): a mesma base do Nibo.
create or replace function erp_baixadas_corp_mensal(p_de date, p_ate date)
returns table (corretora text, seg_abrev text, mes text, linhas bigint, bruto numeric, liquido numeric)
language sql stable
as $$
select c.corretora,
  (case when c.seg_abrev = 'ALF' then 'ALFA' else c.seg_abrev end) as seg_abrev,
  to_char(c.data, 'YYYY-MM') as mes,
  count(*) as linhas,
  round(sum(c.valor), 2) as bruto,
  round(sum(c.valor * (1 - coalesce(ir.pct, 0) / 100.0)), 2) as liquido
from erp_corp_comissoes c
left join erp_corretoras co on co.apelido = c.corretora
left join erp_imposto_retido ir on ir.corretora_id = co.id and ir.seguradora_abrev = (case when c.seg_abrev = 'ALF' then 'ALFA' else c.seg_abrev end)
where c.situacao = 'recebida' and c.data between p_de and p_ate
  and c.ramo is distinct from 'PREM' and c.cancelado is distinct from 'Sim'
group by 1, 2, 3
$$;
