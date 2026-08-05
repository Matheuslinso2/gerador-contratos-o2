-- Apaga a linha "origem vazia" que sobrou de Expan Imóveis e LUMAR (BASE)
-- na TOKIO -- resto do primeiro fix de duplicidade (antes de existir o
-- conceito de origem). As duas linhas boas (O2 Seguros e SegImob) ficam
-- intactas.

-- 1) Conferir antes de apagar:
select coalesce(i.nome, fe.nome_provisorio) as nome, fe.cnpj_o2, fe.dia_vencimento, fe.id
from faturas_esperadas fe
left join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO'
  and coalesce(i.nome, fe.nome_provisorio) in ('Expan Imóveis', 'LUMAR (BASE)')
order by nome, fe.cnpj_o2;

-- 2) Apaga só a linha com origem vazia dessas duas:
delete from faturas_esperadas fe
using imobiliarias i
where fe.imobiliaria_id = i.id
  and fe.seguradora = 'TOKIO'
  and i.nome in ('Expan Imóveis', 'LUMAR (BASE)')
  and fe.cnpj_o2 = '';

-- 3) Conferência final -- deve sumir da lista de duplicados:
select coalesce(i.nome, fe.nome_provisorio) as nome, count(*) as qtd
from faturas_esperadas fe
left join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true
group by coalesce(i.nome, fe.nome_provisorio)
having count(*) > 1;
