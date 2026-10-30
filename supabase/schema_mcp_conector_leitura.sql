-- Conector de leitura (MCP) do Workspace/ERP para o Claude da diretoria
-- (pedido do Fabricio, aprovado em 30/10/2026; entregaveis/conector-leitura/).
-- Só o servidor (service_role) lê e grava estas tabelas: RLS ligado e sem
-- policy = nenhum acesso pelo site.

-- Quem pode usar o conector (além de ter login de equipe O2). Incluir/remover
-- alguém = inserir/apagar a linha, sem publicar código.
create table if not exists public.mcp_autorizados (
  email text primary key,
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now()
);
alter table public.mcp_autorizados enable row level security;
revoke all on public.mcp_autorizados from anon, authenticated;

insert into public.mcp_autorizados (email, observacao) values
  ('matheus@o2seguros.com.br', 'responsável técnico'),
  ('fabricio@o2seguros.com.br', 'diretoria comercial — pedido de 30/10/2026')
on conflict (email) do nothing;

-- Registro de cada consulta (quem, ferramenta, filtros, resultado, tempo).
-- Também serve de base para o limite de consultas por minuto/dia.
create table if not exists public.mcp_acessos (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  email text not null,
  ferramenta text not null,
  parametros jsonb,
  ok boolean not null,
  erro text,
  duracao_ms integer
);
create index if not exists mcp_acessos_email_criado_idx on public.mcp_acessos (email, criado_em desc);
alter table public.mcp_acessos enable row level security;
revoke all on public.mcp_acessos from anon, authenticated;
