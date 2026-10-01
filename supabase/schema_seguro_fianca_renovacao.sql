-- Aba "Renovação" do painel /seguro-fianca (funil de Renovação, categoria
-- 32 da SPA Seguro Fiança). Mesmo modelo de seguro_fianca_snapshots: uma
-- linha por competência; a competência corrente é sobrescrita (upsert) a
-- cada carga da página e a do mês que fechou é congelada pelo cron do dia 1º
-- (/api/cron/congelar-paineis). payload = PainelRenovacao já processado
-- (src/lib/bitrix/renovacaoFianca.ts), não dados brutos do Bitrix.

create table if not exists seguro_fianca_renovacao_snapshots (
  competencia text primary key,        -- ex: '2026-10'
  atualizado_em timestamptz not null default now(),
  payload jsonb not null
);

alter table seguro_fianca_renovacao_snapshots enable row level security;

-- Acesso interno O2, leitura e escrita (a página faz o upsert rodando como o
-- usuário logado) -- mesma política de seguro_fianca_snapshots.
drop policy if exists "seguro_fianca_renovacao_snapshots acesso o2" on seguro_fianca_renovacao_snapshots;
create policy "seguro_fianca_renovacao_snapshots acesso o2"
on seguro_fianca_renovacao_snapshots for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
