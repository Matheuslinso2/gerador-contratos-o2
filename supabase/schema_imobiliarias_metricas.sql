-- Métricas por imobiliária (cotações realizadas/convertidas/prêmio
-- convertido, por produto), pré-computadas a partir de cotacoes_cache.
-- Mesmo princípio de estatisticas_ticket: calcula uma vez na sincronização,
-- os relatórios de Prospecção só leem daqui (nunca recalculam ao vivo).

create table if not exists imobiliarias_metricas (
  id uuid primary key default gen_random_uuid(),
  nome_normalizado text not null unique,
  nome_exemplo text not null,

  incendio_realizadas integer not null default 0,
  incendio_convertidas integer not null default 0,
  incendio_premio_convertido numeric,

  fianca_realizadas integer not null default 0,
  fianca_convertidas integer not null default 0,
  fianca_premio_convertido numeric,
  fianca_status_disponivel boolean not null default false,

  renovacao_realizadas integer not null default 0,
  renovacao_convertidas integer not null default 0,
  renovacao_premio_convertido numeric,
  renovacao_status_disponivel boolean not null default false,

  calculado_em timestamptz not null default now()
);

alter table imobiliarias_metricas enable row level security;

drop policy if exists "imobiliarias_metricas acesso o2" on imobiliarias_metricas;
create policy "imobiliarias_metricas acesso o2"
on imobiliarias_metricas for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
