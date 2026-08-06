select fe.seguradora, fe.cnpj_o2, fe.dia_vencimento, fe.ativo
from faturas_esperadas fe
join imobiliarias i on i.id = fe.imobiliaria_id
where i.cnpj = '42533966000134'
order by fe.seguradora;
