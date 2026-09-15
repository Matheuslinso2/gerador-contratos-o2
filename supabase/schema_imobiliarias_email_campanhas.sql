-- Terceiro campo de e-mail dedicado, separado de email (faturas) e
-- email_repasses -- pedido da reunião de 15/09/2026: campanha comercial
-- pode precisar ir pra um contato diferente de quem recebe fatura ou
-- repasse (às vezes a imobiliária não quer que o time saiba de repasse, e
-- o contato de campanha pode ser um terceiro e-mail). Ver
-- src/lib/campanhas/elegibilidade.ts pra ordem de prioridade na hora de
-- montar a lista de destinatários.
alter table imobiliarias add column if not exists email_campanhas text[];
