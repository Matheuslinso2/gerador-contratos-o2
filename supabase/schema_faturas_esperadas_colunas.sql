-- Colunas novas em faturas_esperadas pra suportar a visão mensal no estilo
-- da planilha de controle: dia de vencimento padrão, qual CNPJ da O2 esse
-- vínculo usa (relevante hoje só pra Porto, que tem senha) e observação
-- livre — tudo isso é uma característica fixa do vínculo imobiliária x
-- seguradora, não muda todo mês (o que muda todo mês é o status de cada
-- fatura em si, já rastreado na tabela faturas).

alter table faturas_esperadas add column if not exists dia_vencimento smallint check (dia_vencimento between 1 and 31);
alter table faturas_esperadas add column if not exists cnpj_o2 text;
alter table faturas_esperadas add column if not exists observacao text;
