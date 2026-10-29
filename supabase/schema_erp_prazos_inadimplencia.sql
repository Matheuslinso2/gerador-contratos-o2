-- ERP O2 (29/10/2026): prazos de pagamento de comissão por seguradora e PROVÁVEL INADIMPLÊNCIA pelo extrato.
-- Aplicado via MCP (migrations erp_prazos_comissao, erp_inadimplencia_provavel, erp_corp_comissoes_venc_idx). Só leitura nas telas.
--
-- Regra do Matheus: se a linha do cliente está no extrato da seguradora, ele pagou; se a comissão esperada (parcela que venceu e passou do
-- prazo habitual da seguradora/ramo) não está em nenhum extrato nem baixada no Corp, a seguradora provavelmente não recebeu o prêmio.
-- A tela só conclui onde o extrato está ligado às parcelas (>= 90% das linhas) e confere com o banco (Nibo).
--
-- erp_prazos_comissao: prazo normal (mediana) e limite (percentil 90, mínimo 10 dias) medidos nos últimos 16 meses de comissões
-- recebidas; fonte 'manual' (editada à mão) nunca é sobrescrita. Remedida de hora em hora pelo cron /api/cron/erp-nibo.
-- Ramos que pagam ANTES do vencimento (prazo normal < -5 dias: antecipada/esgotamento) ficam fora da conta de inadimplência.

create index if not exists erp_corp_comissoes_venc_idx on erp_corp_comissoes (venc_parcela);
create index if not exists erp_extrato_linhas_parcela_idx on erp_extrato_linhas (parcela_id) where parcela_id is not null;

create table if not exists erp_prazos_comissao (
  id bigserial primary key,
  seg_abrev text not null,
  ramo text, -- nulo = a seguradora inteira
  prazo_normal_dias integer not null,
  limite_dias integer not null,
  amostra integer not null default 0,
  fonte text not null default 'medido' check (fonte in ('medido', 'manual')),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists erp_prazos_comissao_ramo_uk on erp_prazos_comissao (seg_abrev, ramo) where ramo is not null;
create unique index if not exists erp_prazos_comissao_seg_uk on erp_prazos_comissao (seg_abrev) where ramo is null;
alter table erp_prazos_comissao enable row level security;
drop policy if exists colab_all on erp_prazos_comissao;
create policy colab_all on erp_prazos_comissao for all using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));

-- erp_atualizar_prazos_comissao(): remede os prazos (security definer; só o service_role executa, chamada pelo cron).
-- erp_previsao_caixa_mensal(p_de, p_ate): comissão que deveria cair por mês (vencimento + prazo normal; fim de semana -> segunda).
-- erp_inadimplencia_provavel(p_de, p_ate): parcelas esperadas x com evidência (extrato ou baixa) x sem evidência, por empresa e seguradora.
-- erp_inadimplencia_provavel_linhas(p_corretora, p_seg, p_de, p_ate): as parcelas sem evidência (até 300), para conferir com a seguradora.
-- erp_extratos_ligacao(p_de, p_ate): quantas linhas de extrato estão ligadas a parcelas (trava da conclusão).
-- erp_baixadas_corp_mensal / erp_previsto_diario: ver schema_erp_baixadas_corp_mensal.sql e schema_erp_previsto_diario.sql.
-- As definições completas estão nas migrations aplicadas (consulte pg_get_functiondef no banco).

create or replace function erp_extratos_ligacao(p_de date, p_ate date)
returns table (corretora text, seg_abrev text, linhas bigint, ligadas bigint)
language sql stable
as $$
select co.apelido, s.abreviacao, count(*), count(l.parcela_id)
from erp_extrato_linhas l
join erp_extratos_seguradora x on x.id = l.extrato_id
join erp_seguradoras s on s.id = x.seguradora_id
left join erp_corretoras co on co.id = x.corretora_id
where coalesce(x.pago_em, x.competencia) between p_de and p_ate
group by 1, 2
$$;
