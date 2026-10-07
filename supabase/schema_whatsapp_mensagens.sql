-- Perguntas recebidas pelo WhatsApp (número de teste da Meta) e as
-- respostas da IA -- Fase 1 do "pergunte ao Workspace pelo WhatsApp"
-- (07/10/2026). Escrita só pelo webhook (/api/whatsapp/webhook, service
-- role). Serve pra: não responder duas vezes a mesma mensagem (a Meta
-- reenvia o evento se demorarmos), dar contexto da conversa pra IA e
-- auditar o que foi perguntado/respondido.

create table if not exists public.whatsapp_mensagens (
  id text primary key, -- wamid da Meta (único por mensagem)
  numero text not null, -- wa_id de quem mandou
  texto text,
  resposta text,
  erro text,
  recebida_em timestamptz not null default now(),
  respondida_em timestamptz
);

create index if not exists whatsapp_mensagens_numero_recebida_idx
  on public.whatsapp_mensagens (numero, recebida_em desc);

alter table public.whatsapp_mensagens enable row level security;

-- Colaborador O2 pode ver (auditoria); escrita só via service role.
drop policy if exists "colaborador_o2_all" on public.whatsapp_mensagens;
create policy "colaborador_o2_all" on public.whatsapp_mensagens
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));
