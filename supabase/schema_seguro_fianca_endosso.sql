-- Aba "Endossos" do painel /seguro-fianca (funil Endossos, categoria 42 da
-- SPA Seguro Fiança, 28/10/2026). Mesmo modelo de
-- seguro_fianca_renovacao_snapshots: uma linha por competência; a corrente é
-- sobrescrita a cada carga da página e a do mês que fechou é congelada pelo
-- cron do dia 1º (/api/cron/congelar-paineis). payload = PainelEndosso já
-- processado (src/lib/bitrix/endossoFianca.ts).

create table if not exists seguro_fianca_endosso_snapshots (
  competencia text primary key,        -- ex: '2026-10'
  atualizado_em timestamptz not null default now(),
  payload jsonb not null
);

alter table seguro_fianca_endosso_snapshots enable row level security;

drop policy if exists "seguro_fianca_endosso_snapshots acesso o2" on seguro_fianca_endosso_snapshots;
create policy "seguro_fianca_endosso_snapshots acesso o2"
on seguro_fianca_endosso_snapshots for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
