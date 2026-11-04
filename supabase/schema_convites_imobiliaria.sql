-- Login verificado de imobiliária (decisão de 04/11/2026): a conta só nasce por convite da O2.
-- 1) A imobiliária pede acesso em /signup (vira pedido, sem criar login) e a equipe O2 avalia em /admin/imobiliarias.
-- 2) A equipe envia o convite pela ficha (e-mail combinado com a imobiliária); o link vale 7 dias.
-- 3) Em /convite/<token> a pessoa recebe um código de 6 números no mesmo e-mail e digita junto com a nova senha (dupla verificação).
-- Só o hash do token e do código é guardado. Acesso às tabelas: equipe O2 (leitura/gravação); a página pública usa service_role.

create table if not exists public.imobiliaria_convites (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expira_em timestamptz not null,
  codigo_hash text,
  codigo_expira_em timestamptz,
  tentativas_codigo int not null default 0,
  enviado_por text not null,
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists imobiliaria_convites_imob_idx on public.imobiliaria_convites (imobiliaria_id);
alter table public.imobiliaria_convites enable row level security;
drop policy if exists "convites equipe" on public.imobiliaria_convites;
create policy "convites equipe" on public.imobiliaria_convites for all to authenticated using (is_equipe_o2()) with check (is_equipe_o2());

create table if not exists public.imobiliaria_pedidos_acesso (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text not null,
  endereco text,
  responsavel text,
  email text not null,
  status text not null default 'pendente' check (status in ('pendente','aprovado','recusado')),
  imobiliaria_id uuid references public.imobiliarias(id) on delete set null,
  avaliado_por text,
  avaliado_em timestamptz,
  criado_em timestamptz not null default now()
);
alter table public.imobiliaria_pedidos_acesso enable row level security;
drop policy if exists "pedidos equipe" on public.imobiliaria_pedidos_acesso;
create policy "pedidos equipe" on public.imobiliaria_pedidos_acesso for all to authenticated using (is_equipe_o2()) with check (is_equipe_o2());
