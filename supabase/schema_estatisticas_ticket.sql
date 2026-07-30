-- Estatísticas de ticket médio pré-calculadas (bairro/região/cidade x faixa
-- de aluguel, por tipo de seguro). Calculadas UMA VEZ ao final de cada
-- sincronização (ver prospeccaoEstatisticas.ts) a partir de todo o cache de
-- cotações — os relatórios de prospecção só fazem uma leitura rápida aqui,
-- nunca recalculam nada na hora.

create table if not exists estatisticas_ticket (
  id uuid primary key default gen_random_uuid(),
  nivel text not null check (nivel in ('bairro', 'regiao', 'cidade')),
  chave text not null,
  cidade text not null,
  tipo text not null check (tipo in ('incendio', 'fianca')),
  faixa text not null,
  ticket_medio numeric not null,
  quantidade integer not null,
  atualizado_em timestamptz not null default now()
);

create index if not exists estatisticas_ticket_busca_idx
  on estatisticas_ticket (nivel, lower(chave), cidade, tipo);

alter table estatisticas_ticket enable row level security;

drop policy if exists "estatisticas_ticket acesso o2" on estatisticas_ticket;
create policy "estatisticas_ticket acesso o2"
on estatisticas_ticket for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
