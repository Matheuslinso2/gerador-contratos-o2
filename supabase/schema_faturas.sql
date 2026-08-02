-- Módulo de Faturas Mensais (boletos de seguradora reenviados às
-- imobiliárias). Uso interno O2 — imobiliárias não acessam essas tabelas.

alter table imobiliarias add column if not exists email_faturas text;
alter table imobiliarias add column if not exists email_repasses text;
-- email_repasses já é criado agora (é barato), mas só passa a ser usado
-- quando o módulo de Repasses for construído.

create table if not exists faturas (
  id uuid primary key default gen_random_uuid(),
  competencia text not null, -- 'AAAA-MM'
  arquivo_bucket_path text not null,
  arquivo_nome text not null,
  arquivo_hash text not null,
  imobiliaria_id uuid references imobiliarias(id),
  seguradora text,
  codigo_produtor text,
  vencimento date,
  valor numeric,
  numero_documento text,
  confianca text check (confianca in ('alta', 'media', 'baixa')),
  status text not null default 'aguardando_identificacao' check (status in (
    'aguardando_upload', 'fatura_carregada', 'aguardando_identificacao',
    'aguardando_conferencia', 'pronta_para_envio', 'enviada', 'erro_no_envio',
    'duplicada', 'cancelada'
  )),
  possivel_duplicidade_de uuid references faturas(id),
  texto_bruto_extraido text,
  historico_identificacao jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id),
  criado_por_email text,
  created_at timestamptz not null default now()
);

create index if not exists faturas_competencia_idx on faturas (competencia);
create index if not exists faturas_imobiliaria_idx on faturas (imobiliaria_id);
create index if not exists faturas_hash_idx on faturas (arquivo_hash);

create table if not exists faturas_esperadas (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references imobiliarias(id),
  seguradora text not null,
  codigo_produtor text,
  ativo boolean not null default true,
  aprendido_em timestamptz not null default now(),
  unique (imobiliaria_id, seguradora, codigo_produtor)
);

create table if not exists faturas_envios (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references imobiliarias(id),
  competencia text not null,
  faturas_ids uuid[] not null,
  envio_parcial boolean not null default false,
  faturas_faltantes_descricao text,
  autorizado_por_email text,
  destinatarios text[] not null,
  cc text[],
  assunto text not null,
  corpo text not null,
  resultado text not null check (resultado in ('sucesso', 'erro')),
  erro_detalhe text,
  enviado_por uuid references auth.users(id),
  enviado_por_email text,
  created_at timestamptz not null default now()
);

alter table faturas enable row level security;
alter table faturas_esperadas enable row level security;
alter table faturas_envios enable row level security;

drop policy if exists "faturas acesso o2" on faturas;
create policy "faturas acesso o2"
on faturas for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "faturas_esperadas acesso o2" on faturas_esperadas;
create policy "faturas_esperadas acesso o2"
on faturas_esperadas for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "faturas_envios acesso o2" on faturas_envios;
create policy "faturas_envios acesso o2"
on faturas_envios for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
