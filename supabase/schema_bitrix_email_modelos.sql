-- Modelos de e-mail criados pela própria equipe na aba "E-mail" dos cards do
-- Bitrix (29/10/2026). Começa só para Leads (1) e Negócios (2) da área
-- comercial: campanhas pedem modelos novos com frequência e não dá para
-- depender de publicar código a cada um. Os modelos de Fiança, Incêndio e
-- Capitalização continuam em src/lib/bitrix/modelosEmail.ts.
--
-- Tabela PRIVADA: RLS ligada e sem política. Só o servidor (service role) lê e
-- grava, porque a aba roda dentro do iframe do Bitrix, sem sessão do Workspace.
-- Excluir = ativo false (o histórico fica).

create table if not exists public.bitrix_email_modelos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 120),
  assunto text not null default '',
  corpo_html text not null default '',
  entidades int[] not null default '{1,2}',
  ativo boolean not null default true,
  criado_por text,
  atualizado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bitrix_email_modelos enable row level security;
create unique index if not exists bitrix_email_modelos_nome_ativo on public.bitrix_email_modelos (lower(nome)) where ativo;
