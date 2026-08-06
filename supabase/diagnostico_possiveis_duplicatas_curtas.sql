-- Confere se BSJ, JSJ, TDC e TWP (criados como pendentes há pouco) já
-- existem de verdade no sistema com CNPJ e nome completo diferente --
-- esses 4 CNPJs já eram conhecidos há semanas.

select 'BSJ' as sigla, i.id, i.nome, i.cnpj, i.cadastro_incompleto
from imobiliarias i where i.cnpj = '28362798000130'
union all
select 'JSJ', i.id, i.nome, i.cnpj, i.cadastro_incompleto
from imobiliarias i where i.cnpj = '44264415000148'
union all
select 'TDC', i.id, i.nome, i.cnpj, i.cadastro_incompleto
from imobiliarias i where i.cnpj = '24848812000150'
union all
select 'TWP', i.id, i.nome, i.cnpj, i.cadastro_incompleto
from imobiliarias i where i.cnpj = '42081096000137';

-- Se algum apareceu acima, confere as faturas_esperadas dele (todas as
-- seguradoras, não só Tokio):
select i.nome, fe.seguradora, fe.cnpj_o2, fe.dia_vencimento, fe.ativo
from faturas_esperadas fe
join imobiliarias i on i.id = fe.imobiliaria_id
where i.cnpj in ('28362798000130', '44264415000148', '24848812000150', '42081096000137')
order by i.nome, fe.seguradora;

-- E os 4 pendentes que acabamos de criar, pra comparar:
select seguradora, nome_provisorio, dia_vencimento, cnpj_o2
from faturas_esperadas
where nome_provisorio in ('BSJ', 'JSJ', 'TDC', 'TWP');
