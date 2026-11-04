-- Acesso temporário de imobiliária (exceção autorizada pelo Matheus em 04/11/2026): login criado sem envio de e-mail,
-- com validade. Ao vencer, o cron /api/cron/encerrar-acessos-temporarios apaga o login e devolve a ficha ao estado anterior
-- (user_id, e-mail e autorização), para a imobiliária refazer o cadastro normal em /signup (que vincula pelo CNPJ).
create table if not exists public.acessos_temporarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  imobiliaria_id uuid not null references public.imobiliarias(id),
  email text not null,
  expira_em timestamptz not null,
  email_antes text,
  autorizado_antes boolean,
  criado_em timestamptz not null default now(),
  encerrado_em timestamptz
);
alter table public.acessos_temporarios enable row level security;
-- sem policies: só o service_role (cron/scripts) lê e grava.
