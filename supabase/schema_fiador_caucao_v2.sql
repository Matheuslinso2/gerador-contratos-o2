-- Correção de rumo: Fiador e Caução não são "produtos" (não têm seguradora por
-- trás e não têm um texto único que a O2 possa validar como as cláusulas de
-- seguro). Cada imobiliária escreve a própria cláusula, igual já faz com o
-- texto-base do contrato.

alter table imobiliarias add column if not exists clausula_fiador text;
alter table imobiliarias add column if not exists clausula_caucao text;

-- Contratos de Fiador/Caução não têm produto (não passam pela biblioteca de
-- seguros), então produto_id vira opcional e guardamos o tipo de garantia
-- escolhido diretamente.
alter table contratos alter column produto_id drop not null;
alter table contratos add column if not exists tipo_garantia_id uuid references tipos_garantia(id);
