-- Item 9 da reunião de 15/09/2026: agendamento de disparo, cancelável
-- antes do envio. "cancelada" já existia no check de status (nunca usado
-- até agora) -- deixado como está, não é o que esse pedido pede (cancelar
-- agendamento volta pra rascunho, editável de novo; não é um estado
-- terminal). "agendada" é o valor novo de verdade.
alter table campanhas drop constraint campanhas_status_check;
alter table campanhas add constraint campanhas_status_check
  check (status = any (array['rascunho', 'agendada', 'enviando', 'concluida', 'cancelada']));

alter table campanhas add column if not exists agendado_para timestamptz;
