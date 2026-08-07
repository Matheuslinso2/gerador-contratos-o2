-- Painel de Produção do Seguro Fiança (CRM Bitrix24, SPA "Seguro Fiança",
-- entityTypeId 1042). Uma linha por competência (mês): a competência
-- corrente é sobrescrita (upsert) a cada carga da página /seguro-fianca,
-- sempre refletindo o estado mais recente do CRM; quando o mês vira, a
-- linha anterior fica congelada como histórico — não é mais tocada, porque
-- a página só faz upsert na competência atual.
-- payload guarda o resultado já processado (kpis, linhas da "contagem
-- mensal", agregados da "análise gerencial") no formato produzido por
-- src/lib/bitrix/seguroFianca.ts — não dados brutos do Bitrix.

create table if not exists seguro_fianca_snapshots (
  competencia text primary key,        -- ex: '2026-08'
  atualizado_em timestamptz not null default now(),
  payload jsonb not null
);

alter table seguro_fianca_snapshots enable row level security;

-- Acesso interno O2, leitura e escrita (a própria página faz o upsert
-- rodando como o usuário logado) — mesmo padrão de schema_prospeccao.sql.
drop policy if exists "seguro_fianca_snapshots acesso o2" on seguro_fianca_snapshots;
create policy "seguro_fianca_snapshots acesso o2"
on seguro_fianca_snapshots for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
