-- Semente pra futura funcionalidade de comunicação interna pra
-- colaboradores O2 (item C da reunião de 15/09/2026 -- ainda sem escopo
-- definido, essa tabela só guarda o dado, não implementa envio nenhum
-- ainda). Lista de e-mails informada pela Jéssica (exportação do Google
-- Workspace), contas "Suspended" excluídas na hora de importar. Array
-- simples (mesmo padrão de campanhas_grupos.imobiliaria_ids), mas aqui é
-- e-mail solto porque não existe tabela de "colaboradores" -- só contas
-- @o2seguros.com.br no Workspace.
create table if not exists avisos_internos_grupos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  emails text[] not null default '{}',
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table avisos_internos_grupos enable row level security;

drop policy if exists "avisos_internos_grupos acesso o2" on avisos_internos_grupos;
create policy "avisos_internos_grupos acesso o2"
on avisos_internos_grupos for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
