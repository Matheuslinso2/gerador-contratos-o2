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
