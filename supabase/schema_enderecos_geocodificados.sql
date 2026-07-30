-- Cache de geocodificação: a planilha de fiança só tem o endereço em texto
-- livre (sem cidade/bairro em colunas separadas). Geocodificar pelo Google
-- Maps a cada relatório gerado seria lento e repetitivo — guarda o
-- resultado aqui na primeira vez que um endereço é visto, e reaproveita
-- depois. Cresce aos poucos conforme relatórios vão sendo gerados.

create table if not exists enderecos_geocodificados (
  id uuid primary key default gen_random_uuid(),
  endereco_normalizado text not null unique,
  bairro text,
  cidade text,
  uf text,
  created_at timestamptz not null default now()
);

alter table enderecos_geocodificados enable row level security;

drop policy if exists "enderecos_geocodificados acesso o2" on enderecos_geocodificados;
create policy "enderecos_geocodificados acesso o2"
on enderecos_geocodificados for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
