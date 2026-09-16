-- Token de acesso da API oficial do Instagram (Meta Graph API), substituindo
-- o Ayrshare (decisão do Matheus, 15/09/2026, pra eliminar o custo mensal).
-- Mesmo padrão de bitrix_app_auth (schema_bitrix_app.sql): 1 linha só
-- (id fixo 'default', não é multi-tenant -- só existe 1 conta de Instagram),
-- sem criptografia, RLS habilitado mas sem policy pública -- utilizada
-- somente pelas rotas de servidor com service role (src/lib/instagram.ts).
--
-- expira_em é sempre a expiração do access_token de LONGA duração (60 dias)
-- -- o token de curta duração (1h) usado só durante o login OAuth nunca é
-- persistido, é descartado assim que trocado pelo de longa duração.

create table if not exists public.instagram_auth (
  id text primary key default 'default',
  access_token text not null,
  instagram_business_account_id text not null,
  instagram_username text,
  expira_em timestamptz not null,
  atualizado_em timestamptz not null default now()
);

alter table public.instagram_auth enable row level security;

-- Nenhuma policy pública é criada intencionalmente -- só service role acessa.
