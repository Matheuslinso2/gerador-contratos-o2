-- ERP O2 (29/10/2026): prazos de pagamento de comissão por seguradora e PROVÁVEL INADIMPLÊNCIA pelo extrato.
-- Aplicado via MCP (migrations erp_prazos_comissao, erp_inadimplencia_provavel, erp_corp_comissoes_venc_idx, erp_inadimplencia_esgotamento,
-- erp_prazos_comissao_teto, erp_inadimplencia_esgotamento_relativo). Só leitura nas telas.
--
-- REGRA DO MATHEUS
--  * Se a linha do cliente está no extrato da seguradora, ele pagou. Se a comissão esperada (parcela vencida e além do prazo habitual da
--    seguradora/ramo) não está em nenhum extrato nem baixada no Corp, a seguradora provavelmente não recebeu o prêmio.
--  * NENHUM produto paga antes do vencimento. A seguradora só gera comissão depois que o cliente paga a 1ª parcela. No ESGOTAMENTO ela
--    concentra a comissão nas primeiras parcelas e deixa um resquício nas seguintes (ex.: 70% de comissão em 4 vezes: 100%, 100%, 20%, 0).
--    O Corp fecha as parcelas seguintes como "recebida" com valor 0 na data do esgotamento (isso é que dava prazo "negativo").
--  * Por isso: (1) os prazos são medidos só com comissões de verdade (valor > 0); (2) a parcela 1 sempre vale; (3) da parcela 2 em diante não
--    se conclui se uma parcela ANTERIOR do mesmo documento foi fechada com valor 0 ou paga com menos de 90% do melhor percentual recebido
--    do documento (sinal RELATIVO: em seguradoras que pagam parte da comissão direto à imobiliária quase nenhuma parcela chega a 99%).
--  * A tela só conclui onde o extrato está ligado às parcelas (>= 90% das linhas) e confere com o banco (Nibo).

create index if not exists erp_corp_comissoes_venc_idx on erp_corp_comissoes (venc_parcela);
create index if not exists erp_corp_comissoes_documento_idx on erp_corp_comissoes (documento_id);
create index if not exists erp_extrato_linhas_parcela_idx on erp_extrato_linhas (parcela_id) where parcela_id is not null;

-- erp_prazos_comissao: prazo normal (mediana) e limite de atraso (percentil 90, mínimo 10 e teto 120 dias) dos últimos 16 meses de comissões
-- recebidas com valor > 0; fonte 'manual' (editada à mão) nunca é sobrescrita. Remedida de hora em hora pelo cron /api/cron/erp-nibo.
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

-- Funções (definições completas nas migrations aplicadas; use pg_get_functiondef no banco):
--   erp_atualizar_prazos_comissao()                      remede os prazos (security definer; só o service_role executa, via cron)
--   erp_previsao_caixa_mensal(p_de, p_ate)               comissão que deveria cair por mês (vencimento + prazo normal; fim de semana -> segunda)
--   erp_inadimplencia_provavel(p_de, p_ate)              parcelas esperadas x com evidência (extrato ou baixa) x sem evidência, por empresa e seguradora
--   erp_inadimplencia_provavel_linhas(corretora, seg, de, ate)   as parcelas sem evidência (até 300), para conferir com a seguradora
--   erp_extratos_ligacao(p_de, p_ate)                    quantas linhas de extrato estão ligadas a parcelas (trava da conclusão)
--   erp_baixadas_corp_mensal / erp_previsto_diario       ver schema_erp_baixadas_corp_mensal.sql e schema_erp_previsto_diario.sql

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
