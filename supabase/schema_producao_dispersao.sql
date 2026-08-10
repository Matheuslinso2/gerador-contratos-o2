-- Estatísticas de dispersão do prêmio por ramo (média, mediana, desvio
-- padrão, quartis, coeficiente de variação) -- recalculada do zero a cada
-- upload de grade, igual às outras tabelas-resumo de producao. Precisa de
-- tabela própria porque mediana/quartis não dão pra calcular só com soma e
-- contagem (o que as outras tabelas-resumo guardam).

create table if not exists producao_resumo_dispersao (
  id uuid primary key default gen_random_uuid(),
  ramo text not null,
  quantidade integer not null default 0,
  media numeric not null default 0,
  mediana numeric not null default 0,
  desvio_padrao numeric not null default 0,
  minimo numeric not null default 0,
  maximo numeric not null default 0,
  q1 numeric not null default 0,
  q3 numeric not null default 0,
  coeficiente_variacao numeric not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (ramo)
);

alter table producao_resumo_dispersao enable row level security;
create policy "colaboradores O2 leem producao_resumo_dispersao" on producao_resumo_dispersao for select using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 escrevem producao_resumo_dispersao" on producao_resumo_dispersao for insert with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
create policy "colaboradores O2 apagam producao_resumo_dispersao" on producao_resumo_dispersao for delete using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
