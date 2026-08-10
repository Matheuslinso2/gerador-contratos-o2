-- Endereço do item segurado (ou, no caso de Automóvel, do endereço
-- residencial do segurado — não existe endereço do "item" nesse ramo, o
-- item é o veículo) -- vem dos relatórios "Relatório de Renovações" (PDF)
-- do CORP, ligado à produção pelo mesmo `nosso_numero` usado em
-- producao_erp. Camada opcional/incremental: nem toda apólice vai ter uma
-- linha aqui (só as que apareceram nos relatórios de renovação já
-- enviados) -- vai crescendo conforme mais relatórios forem chegando.

create table if not exists producao_enderecos (
  id uuid primary key default gen_random_uuid(),
  ramo text not null,
  nosso_numero text not null,
  fonte text not null check (fonte in ('item', 'residencial')),
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  valor_aluguel numeric, -- só preenchido quando existe cobertura "ALUGUEL" (Fiança)
  arquivo_origem text,
  importado_em timestamptz not null default now(),
  unique (ramo, nosso_numero)
);

create index if not exists idx_producao_enderecos_bairro on producao_enderecos (upper(bairro), upper(cidade));
create index if not exists idx_producao_enderecos_nosso_numero on producao_enderecos (nosso_numero);

alter table producao_enderecos enable row level security;
create policy "colaboradores O2 leem producao_enderecos" on producao_enderecos for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_enderecos" on producao_enderecos for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 atualizam producao_enderecos" on producao_enderecos for update using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_enderecos" on producao_enderecos for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

-- Resumo por bairro -- recalculado do zero a cada upload de endereços
-- (junta producao_enderecos com producao_erp por nosso_numero), mesmo
-- padrão das outras tabelas-resumo: o dashboard só lê essa aqui.
create table if not exists producao_resumo_bairro (
  id uuid primary key default gen_random_uuid(),
  ramo text not null,
  bairro text not null,
  cidade text,
  uf text,
  quantidade integer not null default 0,
  premio_total numeric not null default 0,
  aluguel_soma numeric not null default 0,
  aluguel_quantidade integer not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (ramo, bairro, cidade)
);

alter table producao_resumo_bairro enable row level security;
create policy "colaboradores O2 leem producao_resumo_bairro" on producao_resumo_bairro for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_resumo_bairro" on producao_resumo_bairro for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_resumo_bairro" on producao_resumo_bairro for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
