-- Último caso ambíguo da reconciliação: "MONTE ALEGRE GESTAO" (planilha TOO)
-- deve ser "MONTE ALEGRE GESTAO DE LOCAÇÃO" (não a "MONTE ALEGRE" simples,
-- que já foi resolvida separadamente pelo match exato).

update faturas_esperadas fe
set ativo = true, cnpj_o2 = 'O2 Capitalização'
from imobiliarias i
where fe.imobiliaria_id = i.id
  and fe.seguradora = 'TOO'
  and upper(trim(i.nome)) = upper(trim('MONTE ALEGRE GESTAO DE LOCAÇÃO'));

-- Conferência:
select i.nome, fe.seguradora, fe.dia_vencimento, fe.cnpj_o2, fe.ativo
from faturas_esperadas fe
join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOO' and i.nome ilike '%monte alegre%';
