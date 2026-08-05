-- Mostra quem tem mais de 1 linha ativa na TOKIO hoje -- esperado: só
-- EXPAN e LUMAR, com 2 cada (O2 Seguros + SegImob). Qualquer outra coisa
-- aqui é sobra de algum fix anterior que não foi limpa.
select coalesce(i.nome, fe.nome_provisorio) as nome, count(*) as qtd, array_agg(fe.cnpj_o2 order by fe.cnpj_o2) as origens
from faturas_esperadas fe
left join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true
group by coalesce(i.nome, fe.nome_provisorio)
having count(*) > 1
order by qtd desc, nome;
