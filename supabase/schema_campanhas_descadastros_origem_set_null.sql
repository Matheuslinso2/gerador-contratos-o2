-- Excluir campanha (pedido do Matheus, 15/09/2026) precisa funcionar em
-- qualquer status, inclusive já enviada -- mas campanhas_descadastros não
-- tinha "on delete" na FK de origem_campanha_id (default NO ACTION),
-- então excluir uma campanha que já gerou descadastro batia em erro de
-- constraint. SET NULL preserva o registro de opt-out em si (o que importa
-- pra LGPD/compliance), só perde a atribuição de qual campanha causou.
alter table campanhas_descadastros drop constraint campanhas_descadastros_origem_campanha_id_fkey;
alter table campanhas_descadastros add constraint campanhas_descadastros_origem_campanha_id_fkey
  foreign key (origem_campanha_id) references campanhas(id) on delete set null;
