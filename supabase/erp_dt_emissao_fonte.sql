-- 01/11/2026 — data de emissão das apólices (erp_documentos.dt_emissao) passa a ser gravada com fonte e nível:
--   dt_emissao_fonte: pdf_acervo (nível 1) > email_emissao (5) > corp_comissoes (8, comparação; vale até aparecer fonte melhor) | api | manual (domínio fonte_dt_emissao em erp_dominios)
--   função erp_preencher_dt_emissao(): preenche SÓ onde está vazio, descarta datas fora de 2000..hoje+1; roda ao fim de cada carga (PDF lido, e-mail de emissão, importação do Corp).
-- A definição aplicada está no banco (migração erp_dt_emissao_fonte_e_preenchimento).

-- Cadência efetivar a cotação -> emitir a apólice (Matheus 01/11): views erp_cadencia_emissao_v (dias entre a efetivação do card Bitrix, etapa de sucesso, e a data de emissão
-- com prova: PDF nível 1 ou e-mail nível 5; a data do Corp, nível 8, NÃO entra porque é a data de cadastro no Corp e vem antes da efetivação do card) e
-- erp_cadencia_emissao_ref_v (n, mediana, P75, P90 e % em até 7 dias por seguradora e produto). A definição aplicada está no banco (migração erp_cadencia_emissao_v).
-- CORREÇÃO 01/11 (Matheus): a data de emissão do Corp bate com a do PDF em 94% (2.462 de 2.621) e por isso ENTRA na cadência (com a fonte/nível guardados). A efetivação vale só
-- para negócio novo (funis 18 e 20 de Fiança); nos funis de renovação/endosso o card é fechado depois da emissão e distorcia a medida (migração erp_cadencia_emissao_v_corrigida).
