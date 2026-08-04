-- codigo_produtor como NULL quebra a proteção contra duplicidade: o
-- Postgres trata NULL como diferente de NULL, então duas linhas
-- (imobiliaria_id, seguradora, NULL) não seriam pegas como conflito pelo
-- "on conflict" — a mesma combinação poderia duplicar sem erro. Usando ''
-- em vez de NULL quando não se sabe o código, a proteção volta a funcionar.

update faturas_esperadas set codigo_produtor = '' where codigo_produtor is null;
alter table faturas_esperadas alter column codigo_produtor set default '';
alter table faturas_esperadas alter column codigo_produtor set not null;
