-- Permite registrar uma imobiliária esperada mesmo antes de saber o CNPJ
-- dela (guarda o nome cru da planilha em nome_provisorio até alguém
-- resolver/confirmar quem é de verdade e vincular a um registro real em
-- imobiliarias).

alter table faturas_esperadas alter column imobiliaria_id drop not null;
alter table faturas_esperadas add column if not exists nome_provisorio text;

alter table faturas_esperadas drop constraint if exists faturas_esperadas_provisorio_unico;
alter table faturas_esperadas add constraint faturas_esperadas_provisorio_unico
  unique (nome_provisorio, seguradora, codigo_produtor);
