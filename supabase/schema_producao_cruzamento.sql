-- Estatísticas de cross-sell (cruzamento de produtos pelo mesmo cliente,
-- via CPF/CNPJ) -- recalculadas do zero a cada upload de grade, igual às
-- outras tabelas-resumo de producao. Nunca processa ao vivo numa consulta
-- do dashboard.

-- Quantos clientes distintos (CPF/CNPJ) cada ramo tem.
create table if not exists producao_resumo_clientes_ramo (
  id uuid primary key default gen_random_uuid(),
  ramo text not null,
  clientes_distintos integer not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (ramo)
);

-- Quantos clientes distintos têm CADA PAR de ramos ao mesmo tempo (matriz
-- de cesta de produtos) -- ramo_a sempre vem antes de ramo_b em ordem
-- alfabética, pra não duplicar o mesmo par nas duas ordens.
create table if not exists producao_resumo_cruzamento (
  id uuid primary key default gen_random_uuid(),
  ramo_a text not null,
  ramo_b text not null,
  clientes_em_comum integer not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (ramo_a, ramo_b)
);

-- Resumo único da taxa de anexação (attach rate) com Automóvel -- o único
-- produto realmente "fora do imóvel" nos 7 ramos que temos hoje.
create table if not exists producao_resumo_cross_sell (
  id uuid primary key default gen_random_uuid(),
  total_clientes_imobiliario integer not null default 0,
  clientes_imobiliario_com_auto integer not null default 0,
  atualizado_em timestamptz not null default now()
);

alter table producao_resumo_clientes_ramo enable row level security;
alter table producao_resumo_cruzamento enable row level security;
alter table producao_resumo_cross_sell enable row level security;

create policy "colaboradores O2 leem producao_resumo_clientes_ramo" on producao_resumo_clientes_ramo for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_resumo_clientes_ramo" on producao_resumo_clientes_ramo for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_resumo_clientes_ramo" on producao_resumo_clientes_ramo for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

create policy "colaboradores O2 leem producao_resumo_cruzamento" on producao_resumo_cruzamento for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_resumo_cruzamento" on producao_resumo_cruzamento for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_resumo_cruzamento" on producao_resumo_cruzamento for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

create policy "colaboradores O2 leem producao_resumo_cross_sell" on producao_resumo_cross_sell for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_resumo_cross_sell" on producao_resumo_cross_sell for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_resumo_cross_sell" on producao_resumo_cross_sell for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
