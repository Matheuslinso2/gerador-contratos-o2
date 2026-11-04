-- Parcial da campanha na conversa de e-mail única da imobiliária (04/11/2026, pedido do Matheus).
--
-- A parcial deixa de gravar comentário no card do Bitrix: ela é um e-mail que entra na MESMA
-- conversa (thread) do card da imobiliária, a mesma do "E-mail no card" (Re: + In-Reply-To +
-- cópia oculta para o endereço do card), e onde a equipe manda também as informações necessárias.
-- Para a thread encadear, a parcial sai em UMA mensagem para todos os endereços da imobiliária.
--
--   mensagem_unica: o disparo envia uma mensagem só para todos os destinatários pendentes da
--                   campanha (em vez de uma por endereço). Só as parciais usam.
--   card_deal_id:   negócio do Bitrix (funil Campanhas) cuja conversa a parcial continua.
--                   Vazio = a imobiliária ainda não tem card: a parcial sai, mas sem thread.

alter table public.campanhas add column if not exists mensagem_unica boolean not null default false;
alter table public.campanhas add column if not exists card_deal_id bigint;
