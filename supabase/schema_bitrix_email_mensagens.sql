-- Conversas de e-mail por card (21/10/2026): guarda o Message-ID de cada e-mail
-- que passa pelo endereço do card (card-<entityTypeId>-<id>@notificacoes...),
-- tanto os recebidos (resposta do cliente, cópia da equipe) quanto os nossos
-- (chegam por cópia oculta ao mesmo endereço). Serve pra o próximo envio
-- (Panorama, E-mail no card) continuar a conversa certa em vez de abrir outra.
create table if not exists public.bitrix_email_mensagens (
  message_id text primary key,
  entity_type_id int not null,
  item_id int not null,
  direcao text not null check (direcao in ('enviado', 'recebido')),
  remetente text,
  assunto text not null,
  assunto_base text not null,
  in_reply_to text,
  referencias text,
  criado_em timestamptz not null default now()
);

create index if not exists bitrix_email_mensagens_card_idx
  on public.bitrix_email_mensagens (entity_type_id, item_id, criado_em desc);

alter table public.bitrix_email_mensagens enable row level security;

-- Só o servidor (service role) lê/grava; colaborador O2 logado pode consultar.
drop policy if exists "colaborador_o2_tudo" on public.bitrix_email_mensagens;
create policy "colaborador_o2_tudo" on public.bitrix_email_mensagens
  for all to authenticated
  using (public.is_colaborador_o2())
  with check (public.is_colaborador_o2());
