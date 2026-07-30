-- Cache das cotações (incêndio e fiança) extraídas das planilhas do Google
-- Drive. Ler ~30 planilhas ao vivo a cada relatório de prospecção estourava
-- o limite de requisições por minuto da API do Google Sheets. Em vez disso,
-- um processo de sincronização lê cada planilha só quando ela é nova ou foi
-- modificada (comparando a data de modificação do arquivo no Drive) e grava
-- as linhas aqui. Os relatórios passam a consultar só esse cache — rápido,
-- sem chamar o Google ao vivo.

create table if not exists cotacoes_cache (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('incendio', 'fianca')),
  arquivo_id text not null,
  arquivo_nome text not null,
  arquivo_modificado_em timestamptz,
  imobiliaria text,
  nome_pessoa text,
  cidade text,
  bairro text,
  uf text,
  premio numeric,
  status text,
  data_cotacao text,
  endereco text,
  created_at timestamptz not null default now()
);

create index if not exists cotacoes_cache_arquivo_idx on cotacoes_cache (arquivo_id);
create index if not exists cotacoes_cache_tipo_idx on cotacoes_cache (tipo);
create index if not exists cotacoes_cache_imobiliaria_idx on cotacoes_cache (lower(imobiliaria));

alter table cotacoes_cache enable row level security;

drop policy if exists "cotacoes_cache acesso o2" on cotacoes_cache;
create policy "cotacoes_cache acesso o2"
on cotacoes_cache for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
