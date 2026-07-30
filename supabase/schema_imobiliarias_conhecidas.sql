-- Registro interno de imobiliárias já conhecidas pela O2 (nome + CNPJ),
-- usado pela Prospecção para achar o CNPJ de uma imobiliária prospect pelo
-- nome, já que as planilhas de cotação (incêndio/fiança) não têm coluna de
-- CNPJ. Alimentado a partir de exportações do cadastro de produtores da O2
-- e crescendo aos poucos — nunca duplica por CNPJ (upsert).

create table if not exists imobiliarias_conhecidas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text unique,
  cidade text,
  uf text,
  created_at timestamptz not null default now()
);

alter table imobiliarias_conhecidas enable row level security;

drop policy if exists "imobiliarias_conhecidas acesso o2" on imobiliarias_conhecidas;
create policy "imobiliarias_conhecidas acesso o2"
on imobiliarias_conhecidas for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
