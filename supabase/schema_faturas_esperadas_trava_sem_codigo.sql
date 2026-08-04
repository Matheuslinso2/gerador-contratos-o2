-- A trava de duplicidade original incluía codigo_produtor, um campo que
-- nunca aparece na tela de edição (o admin só vê/edita 1 linha por
-- imobiliária+seguradora). Quando a Conferência confirma uma fatura, ela
-- grava o código de produtor lido pela IA -- se vier diferente do que já
-- estava salvo (ou a linha da planilha tinha o campo vazio), o banco não
-- reconhecia como o mesmo vínculo e criava uma linha nova (duplicata visível
-- na tela, ex: "PROCED LOPES & FONSECA" aparecendo duas vezes na mesma aba).
-- Esse script mescla as duplicatas existentes e troca a trava pra
-- (imobiliaria_id, seguradora) apenas, que é o que a tela realmente trata
-- como "1 registro".

-- 1) Conferir duplicatas existentes antes de mexer:
select imobiliaria_id, seguradora, count(*) as qtd
from faturas_esperadas
where imobiliaria_id is not null
group by imobiliaria_id, seguradora
having count(*) > 1;

-- 2) Antes de apagar, traz pra linha que vai sobrar o código de produtor
--    não-vazio, se alguma das duplicatas tiver um.
with melhor_codigo as (
  select imobiliaria_id, seguradora,
         max(nullif(codigo_produtor, '')) as codigo_produtor_bom
  from faturas_esperadas
  where imobiliaria_id is not null
  group by imobiliaria_id, seguradora
),
ranqueadas as (
  select id, imobiliaria_id, seguradora,
    row_number() over (
      partition by imobiliaria_id, seguradora
      order by (dia_vencimento is not null) desc, (cnpj_o2 is not null) desc, aprendido_em asc
    ) as posicao
  from faturas_esperadas
  where imobiliaria_id is not null
)
update faturas_esperadas fe
set codigo_produtor = coalesce(mc.codigo_produtor_bom, fe.codigo_produtor)
from ranqueadas r
join melhor_codigo mc on mc.imobiliaria_id = r.imobiliaria_id and mc.seguradora = r.seguradora
where fe.id = r.id and r.posicao = 1;

-- 3) Apaga as duplicatas restantes (mantém só a linha "melhor" de cada
--    grupo -- prioriza a que já tem vencimento/CNPJ O2 preenchidos).
with ranqueadas as (
  select id, imobiliaria_id, seguradora,
    row_number() over (
      partition by imobiliaria_id, seguradora
      order by (dia_vencimento is not null) desc, (cnpj_o2 is not null) desc, aprendido_em asc
    ) as posicao
  from faturas_esperadas
  where imobiliaria_id is not null
)
delete from faturas_esperadas fe
using ranqueadas r
where fe.id = r.id and r.posicao > 1;

-- 4) Troca a trava antiga por uma que ignora codigo_produtor.
alter table faturas_esperadas
  drop constraint if exists faturas_esperadas_imobiliaria_id_seguradora_codigo_produtor_key;
alter table faturas_esperadas
  add constraint faturas_esperadas_imobiliaria_seguradora_key unique (imobiliaria_id, seguradora);

-- 5) Conferência final -- não deve sobrar nenhum grupo duplicado:
select imobiliaria_id, seguradora, count(*)
from faturas_esperadas
where imobiliaria_id is not null
group by imobiliaria_id, seguradora
having count(*) > 1;
