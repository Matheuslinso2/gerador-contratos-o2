-- Módulo de Campanhas Comerciais (e-mail marketing via Resend para a base
-- de imobiliárias parceiras). Uso interno O2 — imobiliárias não acessam
-- essas tabelas, só o link público de descadastro (fora do RLS, gravado via
-- service role, ver rotas em src/app/campanhas/descadastro e
-- src/app/api/campanhas/descadastro).

create table if not exists campanhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  assunto text not null,
  template text not null default 'comunicado' check (template in ('comunicado', 'promocao', 'newsletter')),
  titulo text not null,
  introducao text,
  corpo_html text not null,
  cta_texto text,
  cta_href text,
  status text not null default 'rascunho' check (status in ('rascunho', 'enviando', 'concluida', 'cancelada')),
  total_destinatarios int not null default 0,
  total_enviados int not null default 0,
  total_falhas int not null default 0,
  criado_por uuid references auth.users(id),
  criado_por_email text,
  disparada_em timestamptz,
  concluida_em timestamptz,
  created_at timestamptz not null default now()
);

-- Fila de envio: 1 linha por endereço de e-mail individual, não por
-- imobiliária -- o campo `email` de imobiliarias pode ter múltiplos
-- endereços separados por vírgula (separarEmails()), e cada endereço é seu
-- próprio "assinante" pra fins de descadastro (se 1 de vários contatos da
-- mesma imobiliária se descadastra, os outros continuam recebendo).
create table if not exists campanhas_envios (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references campanhas(id) on delete cascade,
  imobiliaria_id uuid references imobiliarias(id),
  email text not null,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'descadastrado')),
  tentativas int not null default 0,
  erro_detalhe text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  unique (campanha_id, email)
);

create index if not exists campanhas_envios_fila_idx on campanhas_envios (campanha_id, status);

-- Opt-out GLOBAL por e-mail -- vale pra toda campanha futura, não só a que
-- gerou o clique. Chave é o e-mail (não imobiliaria_id) porque é isso que
-- identifica um "assinante" de verdade.
create table if not exists campanhas_descadastros (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  imobiliaria_id uuid references imobiliarias(id),
  origem_campanha_id uuid references campanhas(id),
  descadastrado_em timestamptz not null default now()
);

alter table campanhas enable row level security;
alter table campanhas_envios enable row level security;
alter table campanhas_descadastros enable row level security;

-- Acesso interno O2 (mesmo padrão de schema_comercial.sql / schema_seguro_
-- fianca.sql) -- a rota pública de descadastro grava via service role
-- (createServiceClient(), ignora RLS), não precisa de policy anônima.
drop policy if exists "campanhas acesso o2" on campanhas;
create policy "campanhas acesso o2"
on campanhas for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "campanhas_envios acesso o2" on campanhas_envios;
create policy "campanhas_envios acesso o2"
on campanhas_envios for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "campanhas_descadastros acesso o2" on campanhas_descadastros;
create policy "campanhas_descadastros acesso o2"
on campanhas_descadastros for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
