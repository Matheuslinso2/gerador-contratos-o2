-- Fase 1: biblioteca de cláusulas de garantia
-- Rode este script no Supabase (SQL Editor) do projeto gerador-contratos-o2

create table if not exists tipos_garantia (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists seguradoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  seguradora_id uuid not null references seguradoras(id) on delete cascade,
  tipo_garantia_id uuid not null references tipos_garantia(id) on delete restrict,
  nome text not null,
  clausula_base text not null,
  created_at timestamptz not null default now(),
  unique (seguradora_id, nome)
);

create table if not exists coberturas_adicionais (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  nome text not null,
  texto text not null,
  created_at timestamptz not null default now()
);

-- Os 3 tipos de garantia já são conhecidos, então já deixamos cadastrados
insert into tipos_garantia (nome) values
  ('Seguro Fiança Locatícia'),
  ('Seguro Incêndio Imobiliário'),
  ('Título de Capitalização')
on conflict (nome) do nothing;
