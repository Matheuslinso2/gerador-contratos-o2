-- Painel Comercial (CRM Bitrix24, Deals padrão, funis "Ativação Novos
-- Clientes" [categoria 1] e "Sucesso do Cliente" [categoria 0]). Uma linha
-- por competência (mês): a competência corrente é sobrescrita (upsert) a
-- cada carga da página /painel-comercial, sempre refletindo o estado mais
-- recente do CRM; quando o mês vira, a linha anterior fica congelada como
-- histórico — não é mais tocada, porque a página só faz upsert na
-- competência atual. Mesmo padrão de schema_seguro_fianca.sql.
-- payload guarda o resultado já processado (todos os ~44 KPIs, já
-- calculados) no formato produzido por src/lib/bitrix/comercial.ts
-- (buscarKpisComercialAoVivo) — não dados brutos do Bitrix.

create table if not exists comercial_kpis_snapshots (
  competencia text primary key,        -- ex: '2026-08'
  atualizado_em timestamptz not null default now(),
  payload jsonb not null
);

alter table comercial_kpis_snapshots enable row level security;

-- Acesso interno O2, leitura e escrita (a própria página faz o upsert
-- rodando como o usuário logado) — mesmo padrão de schema_seguro_fianca.sql.
drop policy if exists "comercial_kpis_snapshots acesso o2" on comercial_kpis_snapshots;
create policy "comercial_kpis_snapshots acesso o2"
on comercial_kpis_snapshots for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
