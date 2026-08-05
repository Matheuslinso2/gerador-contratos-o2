-- Algumas seguradoras (Pottencial, Too, Tokio) mandam a cobrança mensal em
-- 2 arquivos separados por imobiliária: o boleto (pagamento) e o
-- demonstrativo/relatório (lista as apólices/inquilinos). A IA agora
-- classifica cada upload como um dos dois -- essa coluna guarda isso, pra
-- diferenciar o par legítimo de uma duplicata de verdade.

alter table faturas add column if not exists tipo_documento text check (tipo_documento in ('boleto', 'demonstrativo'));
