-- Fase 0 do e-mail dentro do card (Sucesso do Cliente): guarda o token OAuth
-- do aplicativo local do Bitrix. Só existe 1 portal Bitrix nesse projeto, por
-- isso é uma tabela de 1 linha só (id fixo 'default'), sobrescrita a cada
-- instalação/refresh -- não precisa de histórico.
create table if not exists public.bitrix_app_auth (
  id text primary key default 'default',
  dominio text not null,
  member_id text not null,
  access_token text not null,
  refresh_token text not null,
  expira_em timestamptz not null,
  atualizado_em timestamptz not null default now()
);

alter table public.bitrix_app_auth enable row level security;

-- A tabela é utilizada somente pelas APIs de servidor com service role.
-- Nenhuma política pública é criada intencionalmente.
