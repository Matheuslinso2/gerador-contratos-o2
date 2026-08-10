-- Base de produção real (ERP/CORP) que substitui o antigo cache de cotações
-- da Prospecção. Uma linha por apólice/ramo, já sem canceladas e já
-- deduplicada (o CORP gera 2-3 linhas pra mesma apólice quando há mais de
-- um produtor/canal — ver critério de dedupe no código de importação).

create table if not exists producao_erp (
  id uuid primary key default gen_random_uuid(),
  ramo text not null check (ramo in (
    'automovel',
    'fianca_locaticia',
    'capitalizacao',
    'incendio_residencial',
    'incendio_empresarial',
    'incendio_imobiliario',
    'condominio'
  )),
  nosso_numero text not null,
  seguradora text not null,
  seguradora_codigo text,
  produtor text,
  produtor_cpf_cnpj text,
  codigo_produtor text,
  filial text,
  numero_apolice text,
  numero_endosso text,
  cliente_nome text,
  cliente_cpf_cnpj text,
  inicio_vigencia date,
  fim_vigencia date,
  data_proposta date,
  competencia text, -- 'AAAA-MM', derivado de data_proposta -- eixo do tempo do dashboard
  parcelas integer,
  premio_liquido numeric,
  premio_adicional numeric,
  premio_total numeric,
  valor_comissao numeric,
  percentual_comissao numeric,
  valor_comissao_produtor numeric,
  percentual_comissao_produtor numeric,
  base_comissao_corretora numeric,
  tipo text, -- 'NOVO' | 'RENV'
  canal_vendas text,
  arquivo_origem text,
  importado_em timestamptz not null default now(),
  unique (ramo, nosso_numero)
);

create index if not exists idx_producao_erp_ramo on producao_erp (ramo);
create index if not exists idx_producao_erp_competencia on producao_erp (competencia);
create index if not exists idx_producao_erp_produtor on producao_erp (lower(produtor));
create index if not exists idx_producao_erp_seguradora on producao_erp (seguradora);

alter table producao_erp enable row level security;
create policy "colaboradores O2 leem producao_erp"
  on producao_erp for select
  using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_erp"
  on producao_erp for insert
  with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 atualizam producao_erp"
  on producao_erp for update
  using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_erp"
  on producao_erp for delete
  using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

-- ---------------------------------------------------------------------
-- Tabelas-resumo: recalculadas do zero a cada upload processado (nunca ao
-- vivo numa consulta do dashboard) -- são pequenas (no máximo algumas
-- centenas de linhas), então o dashboard só faz SELECTs simples nelas.

create table if not exists producao_resumo_mensal (
  id uuid primary key default gen_random_uuid(),
  ramo text not null,
  competencia text not null,
  tipo text not null, -- 'NOVO' | 'RENV'
  quantidade integer not null default 0,
  premio_total numeric not null default 0,
  comissao_corretora numeric not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (ramo, competencia, tipo)
);

create table if not exists producao_resumo_produtor (
  id uuid primary key default gen_random_uuid(),
  produtor text not null,
  ramo text not null,
  quantidade integer not null default 0,
  premio_total numeric not null default 0,
  comissao_corretora numeric not null default 0,
  comissao_produtor numeric not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (produtor, ramo)
);

create table if not exists producao_resumo_seguradora (
  id uuid primary key default gen_random_uuid(),
  seguradora text not null,
  ramo text not null,
  quantidade integer not null default 0,
  premio_total numeric not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (seguradora, ramo)
);

alter table producao_resumo_mensal enable row level security;
alter table producao_resumo_produtor enable row level security;
alter table producao_resumo_seguradora enable row level security;

create policy "colaboradores O2 leem producao_resumo_mensal" on producao_resumo_mensal for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_resumo_mensal" on producao_resumo_mensal for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_resumo_mensal" on producao_resumo_mensal for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

create policy "colaboradores O2 leem producao_resumo_produtor" on producao_resumo_produtor for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_resumo_produtor" on producao_resumo_produtor for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_resumo_produtor" on producao_resumo_produtor for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

create policy "colaboradores O2 leem producao_resumo_seguradora" on producao_resumo_seguradora for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_resumo_seguradora" on producao_resumo_seguradora for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_resumo_seguradora" on producao_resumo_seguradora for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
