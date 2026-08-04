-- Tenta resolver os registros ainda pendentes de CNPJ (nome_provisorio)
-- comparando por aproximação (um nome "contém" o outro) contra a base
-- imobiliarias_conhecidas — mais flexível que a igualdade exata usada na
-- primeira importação. Só aplica quando encontra exatamente UMA
-- correspondência; se achar mais de uma (nome ambíguo), não mexe, fica
-- pendente mesmo pra conferência manual.

with pendentes as (
  select id, nome_provisorio, seguradora
  from faturas_esperadas
  where imobiliaria_id is null and nome_provisorio is not null and nome_provisorio <> ''
),
candidatos as (
  select
    p.id, p.nome_provisorio, p.seguradora, ic.nome as nome_ic, ic.cnpj,
    count(*) over (partition by p.id) as qtd
  from pendentes p
  join imobiliarias_conhecidas ic
    on ic.cnpj is not null and trim(ic.cnpj) <> ''
    and (
      ic.nome ilike '%' || p.nome_provisorio || '%'
      or p.nome_provisorio ilike '%' || ic.nome || '%'
    )
),
unicos as (
  select id, nome_provisorio, seguradora, nome_ic, cnpj
  from candidatos
  where qtd = 1
)
insert into imobiliarias (nome, cnpj, texto_base_contrato, indice_reajuste, percentual_multa_atraso, percentual_juros_mora, percentual_honorarios_advocaticios, dia_vencimento_aluguel)
select distinct on (u.cnpj) u.nome_ic, u.cnpj, '', '', 0, 0, 0, 1
from unicos u
where not exists (select 1 from imobiliarias i where i.cnpj = u.cnpj);

-- Segunda parte: agora que os registros novos de imobiliarias já existem,
-- liga cada pendente encontrado (mesma lógica de correspondência única).
with pendentes as (
  select id, nome_provisorio, seguradora
  from faturas_esperadas
  where imobiliaria_id is null and nome_provisorio is not null and nome_provisorio <> ''
),
candidatos as (
  select
    p.id, p.nome_provisorio, p.seguradora, ic.cnpj,
    count(*) over (partition by p.id) as qtd
  from pendentes p
  join imobiliarias_conhecidas ic
    on ic.cnpj is not null and trim(ic.cnpj) <> ''
    and (
      ic.nome ilike '%' || p.nome_provisorio || '%'
      or p.nome_provisorio ilike '%' || ic.nome || '%'
    )
),
unicos_brutos as (
  select id, seguradora, cnpj
  from candidatos
  where qtd = 1
),
-- Se duas linhas pendentes diferentes (nomes quase iguais) baterem pro
-- mesmo CNPJ na mesma seguradora, só a de menor id é resolvida agora — a
-- outra fica pendente pra conferência manual, em vez de derrubar o UPDATE
-- inteiro por violar a proteção contra duplicidade.
unicos as (
  select distinct on (seguradora, cnpj) id, seguradora, cnpj
  from unicos_brutos
  order by seguradora, cnpj, id
)
update faturas_esperadas fe
set imobiliaria_id = i.id, nome_provisorio = null
from unicos u
join imobiliarias i on i.cnpj = u.cnpj
where fe.id = u.id
  -- pula se já existir esse par imobiliaria+seguradora (evita violar a
  -- proteção contra duplicidade em vez de derrubar o script inteiro)
  and not exists (
    select 1 from faturas_esperadas fe2
    where fe2.imobiliaria_id = i.id and fe2.seguradora = u.seguradora and fe2.id <> fe.id
  );
