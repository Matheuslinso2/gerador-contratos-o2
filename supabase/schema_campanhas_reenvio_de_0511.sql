-- Reenvio de campanha na conversa do card (05/11/2026, pedido do Matheus).
--
-- Os cards do Bitrix ficam ligados à campanha ORIGINAL (campanhas_cards_bitrix: um card só pode estar numa campanha). O botão "Reenviar"
-- cria uma cópia nova; esta coluna aponta a cópia para a original, para o reenvio achar os cards e entrar na conversa de cada imobiliária.
alter table public.campanhas add column if not exists reenvio_de uuid references public.campanhas(id) on delete set null;
