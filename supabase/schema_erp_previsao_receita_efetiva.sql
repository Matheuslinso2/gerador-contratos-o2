-- ERP O2 — previsão de receita (comissão) 100% do ERP, sem ancorar no Corp (05/11/2026). Aplicado no banco; este arquivo versiona a função. Só leitura.
-- Base: erp_comissoes (comissão prevista por parcela) + erp_parcelas + erp_documentos. Competência = mês do RECEBIMENTO (status 'recebida'); o mês da previsão (vencimento + prazo da seguradora) é estimativa.
-- Parcelas "fantasmas" NÃO entram na previsão: documento cancelado a partir do cancelamento (e sem quitação) e documento 'duplicado' (gêmea consolidada). Aparecem à parte para conferência.
-- O aberto restante: a_vencer (prazo ainda não passou), atrasada_cliente_pagou (parcela quitada, comissão não baixada = baixa pendente) e atrasada_vencida_sem_quitacao (candidata a inadimplência, justificativa de falta de receita).
-- Achado out/2026: previsto 626 mil = recebida 398 mil + 227,6 mil "prevista"; desses, 64 mil cancelado + 31 mil duplicado eram fantasmas; sobram 21 mil (cliente pagou) + 112 mil (vencida sem quitação).
-- Somente service_role (dado financeiro da O2): chamar com createServiceClient() depois de checar o e-mail no servidor (podeVerNibo). Migração "erp_previsao_receita_efetiva".
-- Pendente: teste de duplicidade entre documentos vigentes (mesmo segurado/seguradora/parcela/início) — rodar em lotes (a consulta única estourou o tempo; ver incidente 04/11).
create or replace function public.erp_previsao_receita_efetiva(p_de date, p_ate date)
returns table(mes text, corretora text, previsto_efetivo numeric, recebida numeric, a_vencer numeric, atrasada_cliente_pagou numeric, atrasada_vencida_sem_quitacao numeric, fantasma_cancelado numeric, fantasma_duplicado numeric, parcelas_efetivas bigint)
language sql stable security invoker set search_path = public as $$
  with b as (
    select to_char(c.previsao_recebimento,'YYYY-MM') mes, coalesce(co.apelido,'?') corretora, c.valor_previsto v, c.status,
      c.previsao_recebimento prev, p.quitada_em, p.vencimento,
      (d.situacao = 'cancelado' and (d.cancelado_em is null or p.vencimento >= d.cancelado_em) and p.quitada_em is null
        and not exists (select 1 from erp_parcelas p2 where p2.documento_id = d.id and p2.quitada_em is not null and (d.cancelado_em is null or p2.vencimento >= d.cancelado_em))) fant_canc, -- v2 05/11: cancelada COM parcela paga depois do cancelamento rodou de fato (o pagamento prevalece), não é fantasma
      (d.situacao = 'duplicado') fant_dup
    from erp_comissoes c
    join erp_parcelas p on p.id = c.parcela_id
    join erp_documentos d on d.id = p.documento_id
    left join erp_corretoras co on co.id = d.corretora_id
    where c.tipo = 'comissao' and c.previsao_recebimento between p_de and p_ate
  )
  select mes, corretora,
    round(sum(v) filter (where status = 'recebida' or not (fant_canc or fant_dup)), 2),
    round(coalesce(sum(v) filter (where status = 'recebida'), 0), 2),
    round(coalesce(sum(v) filter (where status = 'prevista' and not (fant_canc or fant_dup) and prev >= current_date), 0), 2),
    round(coalesce(sum(v) filter (where status = 'prevista' and not (fant_canc or fant_dup) and prev < current_date and quitada_em is not null), 0), 2),
    round(coalesce(sum(v) filter (where status = 'prevista' and not (fant_canc or fant_dup) and prev < current_date and quitada_em is null), 0), 2),
    round(coalesce(sum(v) filter (where status = 'prevista' and fant_canc), 0), 2),
    round(coalesce(sum(v) filter (where status = 'prevista' and fant_dup and not fant_canc), 0), 2),
    count(*) filter (where status = 'recebida' or not (fant_canc or fant_dup))
  from b group by 1, 2
$$;
revoke all on function public.erp_previsao_receita_efetiva(date, date) from public, anon, authenticated;
grant execute on function public.erp_previsao_receita_efetiva(date, date) to service_role;
