-- Dia de vencimento do aluguel vira um dado de cada locação, não mais um
-- padrão fixo da imobiliária (cada contrato pode ter um dia diferente).

alter table imobiliarias alter column dia_vencimento_aluguel drop not null;

alter table contratos add column if not exists dia_vencimento_aluguel smallint
  check (dia_vencimento_aluguel between 1 and 31);
