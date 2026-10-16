-- Nome da pessoa exibido como remetente da campanha ("Henrique | O2 Seguros").
-- Só o nome de exibição: o endereço de envio não muda. Null = "O2 Seguros".
alter table public.campanhas add column if not exists remetente_nome text;
