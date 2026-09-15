-- Item 8 da reunião de 15/09/2026, reformulado pelo Matheus: importação de
-- contatos via Excel dentro da tela de Grupos, mas especificamente pra
-- campanha de PROSPECÇÃO -- imobiliárias que NÃO têm cadastro no
-- Workspace (por isso não entram na tabela `imobiliarias`, que é a base de
-- clientes reais). Tabela própria, não jsonb dentro de campanhas_grupos,
-- pra poder ter unique (grupo_id, email) e evitar duplicar contato no
-- mesmo grupo em reimportações.
create table if not exists campanhas_grupos_contatos (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references campanhas_grupos(id) on delete cascade,
  nome text not null,
  email text not null,
  cpf_cnpj text,
  criado_em timestamptz not null default now(),
  unique (grupo_id, email)
);

create index if not exists campanhas_grupos_contatos_grupo_idx on campanhas_grupos_contatos (grupo_id);

alter table campanhas_grupos_contatos enable row level security;

drop policy if exists "campanhas_grupos_contatos acesso o2" on campanhas_grupos_contatos;
create policy "campanhas_grupos_contatos acesso o2"
on campanhas_grupos_contatos for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
