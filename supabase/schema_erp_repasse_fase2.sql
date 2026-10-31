-- ERP · Repasses · Fase 2 (aditiva; já aplicada: migration erp_repasse_fase2_gatilho_da_baixa).
-- O repasse nasce da baixa feita pelo ERP (recebimento origem 'extrato'). Baixas do Corp (origem 'corp') ficam de fora: as duas
-- rodam em paralelo para comparação (Matheus 30/10). A linha do extrato decide: cheia = repasse a pagar (pendente);
-- pro_labore_direto = quitado pela seguradora (cancelado, com motivo). Divergente/estorno/não encontrada não geram baixa, logo não geram repasse.
-- competencia = 1º dia do mês do repasse (mês seguinte ao recebimento); previsão = dia 15; retenção 18% por linha só para guardar
-- (a tela soma o bruto da imobiliária e aplica 18% no total).
alter table erp_repasses add column if not exists motivo text;
create unique index if not exists erp_repasses_recebimento_produtor_uq on erp_repasses (comissao_recebimento_id, documento_produtor_id) where comissao_recebimento_id is not null;

create or replace function erp_gerar_repasse_da_baixa() returns trigger language plpgsql security definer set search_path = public as $$
declare v_conf text; v_pl boolean; v_base numeric; v_comp date;
begin
  if new.origem is distinct from 'extrato' then return new; end if;
  select l.conferencia into v_conf from erp_extrato_linhas l where l.id = new.extrato_linha_id;
  v_pl := (v_conf = 'pro_labore_direto');
  select c.base into v_base from erp_comissoes c where c.id = new.comissao_id;
  v_comp := (date_trunc('month', new.recebido_em) + interval '1 month')::date;
  insert into erp_repasses (documento_produtor_id, comissao_recebimento_id, imobiliaria_id, tipo, competencia, valor_bruto, pct_retencao,
                            valor_retido, valor_liquido, previsao, status, motivo)
  select dp.id, new.id, dp.imobiliaria_id, 'comissao', v_comp,
         round(coalesce(v_base, 0) * dp.repasse_pct / 100 * coalesce(dp.pct_participacao, 100) / 100, 2), 18,
         case when v_pl then 0 else round(round(coalesce(v_base, 0) * dp.repasse_pct / 100 * coalesce(dp.pct_participacao, 100) / 100, 2) * 0.18, 2) end,
         case when v_pl then 0 else round(coalesce(v_base, 0) * dp.repasse_pct / 100 * coalesce(dp.pct_participacao, 100) / 100, 2)
              - round(round(coalesce(v_base, 0) * dp.repasse_pct / 100 * coalesce(dp.pct_participacao, 100) / 100, 2) * 0.18, 2) end,
         v_comp + 14,
         case when v_pl then 'cancelado' else 'pendente' end,
         case when v_pl then 'quitado pelo pró-labore pago direto pela seguradora' else null end
    from erp_comissoes c
    join erp_parcelas p on p.id = c.parcela_id
    join erp_documento_produtores dp on dp.documento_id = p.documento_id
   where c.id = new.comissao_id and dp.imobiliaria_id is not null and coalesce(dp.repasse_pct, 0) > 0
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists erp_repasse_da_baixa on erp_comissao_recebimentos;
create trigger erp_repasse_da_baixa after insert on erp_comissao_recebimentos for each row execute function erp_gerar_repasse_da_baixa();

-- Comparação ERP × Corp (só leitura; migration erp_repasse_comparacao_erp_corp): erp_repasse_comparacao(mes) devolve, por repasse gerado
-- pelo ERP, o valor do ERP e o que o Corp calcularia para a MESMA parcela (null enquanto o Corp não baixou). Usada em /erp/repasses/comparacao.

-- Preparo do repasse (só leitura; migrations erp_comissoes_prevista_previsao_idx): índice parcial das comissões previstas por data e
-- erp_repasse_preparo(mes) = por imobiliária: parcelas/bruto da simulação, sem repasse, pró-labore, baixa divergente, comissões do mês anterior
-- ainda sem baixa, parcelas em atraso (avisos das seguradoras) e falta de cadastro. Usada em /erp/repasses/preparo.

-- FASE 3 (migration erp_repasse_fase3_autorizar_e_pagamento_nibo, já aplicada): lote autorizado e pagamento confirmado SÓ pelo Nibo.
--   erp_repasse_lotes ganha status 'autorizado' e colunas autorizado_em/por, nibo_entry_id (único), nibo_valor, relatorio_enviado_em.
--   erp_autorizar_repasse(imobiliaria, mês): reúne os repasses pendentes até o mês (acumula), trava bruto/18% (só comissão; premiação sem desconto)/líquido
--     num lote 'autorizado' e põe as linhas em 'em_lote'. Pendências NÃO bloqueiam (falha de baixa é erro de processo).
--   erp_cancelar_autorizacao_repasse(lote): desfaz enquanto não pago.
--   erp_conferir_pagamentos_repasse(): lançamento de pagamento do Nibo, categoria '1.1 REPASSE - COMISSÕES', valor = líquido autorizado (±1 centavo),
--     data >= autorização e favorecido com uma palavra do nome da imobiliária -> lote e repasses 'pago'. Chamar após cada sync do Nibo.

-- DESEMPENHO (migration erp_repasse_resumo_pronto, já aplicada): retrato pronto da tela de Repasses.
--   erp_repasse_resumo_pronto (mes, imobiliaria_id, ...) = por mês de repasse × imobiliária: simulação do Corp, pendências (sem baixa, divergente, atraso,
--     pró-labore, cadastro) e agregados do ERP (pendente, do mês, autorizadas) + gerado_em. RLS: colaborador O2. Índice erp_repasses(competencia, status, imobiliaria_id).
--   erp_atualizar_repasse_resumo(mes) refaz um mês; erp_atualizar_repasse_resumo_abertos() refaz anterior/atual/seguinte e só cria os mais antigos se faltarem.
--   Cron /api/cron/erp-repasse-resumo às :58 (depois da baixa automática :55) + refeito a cada autorização/cancelamento + botão “Atualizar agora”.
--   Medido como usuário autenticado (RLS): tela principal 2.365 ms -> 0,7 ms; ficha da imobiliária (mês aberto) 47 ms; aviso “Comissão recebida” 40 ms.

-- GUIA DE FONTES (31/10, migration erp_repasse_regerar_da_baixa): erp_regerar_repasse_da_baixa(recebimento) refaz o repasse de UMA baixa já gravada
-- (idempotente pelo índice único) e é o que o gatilho passa a chamar. Serve quando um produtor/imobiliária é vinculado depois da baixa.
-- Caso aplicado: 8 apólices Tokio (7784535 a 7784575, baixadas em 28/10) sem produtor; imobiliária principal do documento = PINTAS, confirmada pelo PDF da apólice
-- (nome e CNPJ, nível 1); regra da ficha Pintas × Tokio = 0% -> vínculo gravado com a fonte em motivo_diferenca, sem repasse a pagar.

-- PRÓ-LABORE OFICIAL (31/10, migration erp_repasse_abate_pro_labore_oficial): o extrato do Segimob (erp_pro_labore_linhas, por documento e parcela, nível 1 do guia)
-- mostra o que a seguradora já pagou DIRETO à imobiliária; isso quita/abate o repasse da O2 (nunca pagar em dobro).
--   erp_aplicar_pro_labore_oficial(recebimento|null): recalcula do zero (base × % repasse × % participação − pró-labore da mesma parcela); resíduo < R$ 0,10 = quitado
--   (status 'cancelado' + motivo); parcial = 'pendente' com valor abatido. Só repasses sem lote. Coluna erp_repasses.pro_labore_abatido guarda o abatimento.
--   Roda no gatilho da baixa e a cada atualização horária do retrato (os extratos do Segimob chegam depois da baixa). 31/10: 49 quitados (R$ 664) e 2 abatidos.
--   Parcelas sem linha de pró-labore ficam como estão (a regra se corrige sozinha quando o extrato do Segimob chegar, enquanto o repasse não estiver em lote).
