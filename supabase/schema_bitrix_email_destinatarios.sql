-- Destinatários da conversa de e-mail de cada card (29/10/2026, reunião Kamila):
-- o "E-mail no card" abre com Para/Cc já preenchidos quando o card tem conversa.
-- Gravado a cada envio pelo card e ao vincular uma conversa do Gmail.
create table if not exists public.bitrix_email_destinatarios (
  entity_type_id int not null,
  item_id int not null,
  primary key (entity_type_id, item_id),
  para text[] not null default '{}',
  cc text[] not null default '{}',
  origem text not null default 'envio',
  atualizado_em timestamptz not null default now()
);
alter table public.bitrix_email_destinatarios enable row level security;
drop policy if exists "colaborador_o2_tudo" on public.bitrix_email_destinatarios;
create policy "colaborador_o2_tudo" on public.bitrix_email_destinatarios
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));
