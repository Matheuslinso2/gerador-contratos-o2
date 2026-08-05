-- Recupera a relação SegImob de EXPAN e LUMAR na TOKIO, apagada pela trava
-- antiga (imobiliaria_id, seguradora) -- rode DEPOIS de
-- schema_faturas_esperadas_origem_na_trava.sql (precisa da trava nova pra
-- funcionar o "on conflict"). Idempotente: pode rodar mais de uma vez sem
-- duplicar.

-- 1) Conferir quem é EXPAN e LUMAR hoje na TOKIO (e o dado que sobreviveu):
select fe.imobiliaria_id, i.nome, fe.cnpj_o2, fe.dia_vencimento, fe.observacao
from faturas_esperadas fe
join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true and (i.nome ilike '%expan%' or i.nome ilike '%lumar%');

-- 2) Garante as 2 origens de cada uma (O2 Seguros + SegImob), com os
--    vencimentos exatos da planilha original. Não mexe em nenhuma outra
--    imobiliária.
insert into faturas_esperadas (imobiliaria_id, seguradora, cnpj_o2, dia_vencimento, ativo)
select fe.imobiliaria_id, 'TOKIO', 'O2 Seguros', 15, true
from faturas_esperadas fe join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true and i.nome ilike '%expan%'
union all
select fe.imobiliaria_id, 'TOKIO', 'SegImob', 20, true
from faturas_esperadas fe join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true and i.nome ilike '%expan%'
union all
select fe.imobiliaria_id, 'TOKIO', 'O2 Seguros', 15, true
from faturas_esperadas fe join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true and i.nome ilike '%lumar%'
union all
select fe.imobiliaria_id, 'TOKIO', 'SegImob', 23, true
from faturas_esperadas fe join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true and i.nome ilike '%lumar%'
on conflict (imobiliaria_id, seguradora, cnpj_o2) do update
  set dia_vencimento = excluded.dia_vencimento, ativo = true;

-- 3) Conferência final -- deve mostrar 2 linhas pra cada nome:
select fe.imobiliaria_id, i.nome, fe.cnpj_o2, fe.dia_vencimento
from faturas_esperadas fe
join imobiliarias i on i.id = fe.imobiliaria_id
where fe.seguradora = 'TOKIO' and fe.ativo = true and (i.nome ilike '%expan%' or i.nome ilike '%lumar%')
order by i.nome, fe.cnpj_o2;
