select coalesce(i.nome, fe.nome_provisorio) as nome, fe.cnpj_o2
from faturas_esperadas fe
left join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true
order by nome;
