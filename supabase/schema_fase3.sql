-- Fase 3: geração de contrato
-- Rode este script no Supabase (SQL Editor) do projeto gerador-contratos-o2

create table if not exists contratos (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references imobiliarias(id),
  produto_id uuid not null references produtos(id),
  locador text not null,
  locador_procurador boolean not null default false,
  locatario text not null,
  ocupantes_adicionais text,
  endereco_imovel text not null,
  finalidade text not null check (finalidade in ('residencial', 'nao_residencial')),
  valor_aluguel numeric not null,
  data_inicio date not null,
  prazo_meses integer not null,
  laudo_vistoria_url text,
  texto_gerado text not null,
  created_at timestamptz not null default now()
);

create table if not exists contratos_coberturas (
  contrato_id uuid not null references contratos(id) on delete cascade,
  cobertura_id uuid not null references coberturas_adicionais(id),
  primary key (contrato_id, cobertura_id)
);
