-- Painel de Ramos Elementares.
-- A fonte operacional no Google Drive/Sheets permanece somente leitura.
-- Esta tabela guarda o último retrato processado de cada competência para
-- histórico mensal e contingência quando o Google estiver indisponível.

create table if not exists ramos_elementares_snapshots (
  competencia text primary key,
  planilha_id text not null,
  planilha_titulo text not null,
  atualizado_em timestamptz not null default now(),
  payload jsonb not null
);

alter table ramos_elementares_snapshots enable row level security;

drop policy if exists "ramos_elementares_snapshots acesso o2" on ramos_elementares_snapshots;
create policy "ramos_elementares_snapshots acesso o2"
on ramos_elementares_snapshots for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
