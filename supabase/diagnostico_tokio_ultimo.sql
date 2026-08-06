select coalesce(i.nome, fe.nome_provisorio) as nome, count(*) as qtd, array_agg(fe.cnpj_o2 order by fe.cnpj_o2) as origens
from faturas_esperadas fe
left join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true
group by coalesce(i.nome, fe.nome_provisorio)
having count(*) > 1
order by qtd desc, nome;
