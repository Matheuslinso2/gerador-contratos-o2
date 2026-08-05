-- A trava anterior (imobiliaria_id, seguradora) presumia 1 relação só por
-- imobiliária+seguradora. Mas na TOKIO existem imobiliárias com 2 relações
-- de verdade pra mesma seguradora -- uma via O2 Seguros e outra via
-- SegImob (plataforma terceirizada), cada uma com vencimento e status
-- próprios. A trava anterior apagou uma dessas duas linhas (ver script de
-- recuperação em dados_recuperar_expan_lumar_segimob.sql). Essa migração
-- troca a trava pra incluir a origem (cnpj_o2), que é o que realmente
-- distingue essas relações.

update faturas_esperadas set cnpj_o2 = '' where cnpj_o2 is null;
alter table faturas_esperadas alter column cnpj_o2 set default '';
alter table faturas_esperadas alter column cnpj_o2 set not null;

alter table faturas_esperadas
  drop constraint if exists faturas_esperadas_imobiliaria_seguradora_key;
alter table faturas_esperadas
  add constraint faturas_esperadas_imobiliaria_seguradora_origem_key unique (imobiliaria_id, seguradora, cnpj_o2);
