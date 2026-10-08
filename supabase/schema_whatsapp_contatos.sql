-- Quem pode conversar com o Workspace pelo WhatsApp (08/10/2026) --
-- substitui a variável WHATSAPP_RELATORIO_DESTINATARIOS do Vercel por um
-- cadastro editável em /admin/whatsapp. tipo 'equipe' = equipe O2 (vê
-- tudo, decisão do Matheus); tipo 'imobiliaria' = contato de uma
-- imobiliária parceira, que só pode ver os dados da própria imobiliária
-- (Fase C -- trava no código, ver lib/whatsappContatos.ts).

create table if not exists public.whatsapp_contatos (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique, -- só dígitos, com DDI: 5521999990000
  nome text not null,
  tipo text not null check (tipo in ('equipe', 'imobiliaria')),
  imobiliaria_id uuid references public.imobiliarias (id) on delete cascade,
  recebe_relatorio boolean not null default false, -- relatório das 8h
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por_email text,
  constraint whatsapp_contatos_imobiliaria_obrigatoria
    check (tipo <> 'imobiliaria' or imobiliaria_id is not null)
);

create index if not exists whatsapp_contatos_imobiliaria_idx on public.whatsapp_contatos (imobiliaria_id);

alter table public.whatsapp_contatos enable row level security;

drop policy if exists "colaborador_o2_all" on public.whatsapp_contatos;
create policy "colaborador_o2_all" on public.whatsapp_contatos
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));
