-- ERP O2 — vínculo card do Bitrix (proposta) × documento do Corp pela pontuação de evidências (Matheus, 03/11/2026).
-- Migrations aplicadas: erp_vinculo_pontuar_card_corp(p_lote, p_de, p_ate) e erp_juntar_card_corp_par(card, corp, nivel, motivo).
--  * erp_vinculo_pontuar_card_corp só REGISTRA a pontuação em erp_vinculo_pontuacao (tipo 'proposta_card_corp'); nunca altera o vínculo.
--  * Com os pesos atuais (card do Bitrix 0,6 × Corp 0,4, mínimo 90 pontos) nenhum par chega a "vincula" (máximo 47): a calibração foi pensada para documento oficial.
--  * Critério aprovado pelo Matheus para "alta confiança": mesma seguradora + prêmio líquido igual (±R$ 1) + vigência igual ou ≤ 7 dias +
--    (cliente igual OU imobiliária igual) + candidato ÚNICO e ESCOLHA MÚTUA (o documento do Corp não é candidato melhor ou igual de outro card).
--  * erp_juntar_card_corp_par junta o card ao documento do Corp (mesma lógica de erp_juntar_cards_corp): move origem, itens, e-mails, anexos e eventos,
--    marca o card como 'duplicado' com observação do nível. Em 03/11/2026: lote CARDCORP-0311, 365 propostas no período, 272 com candidato;
--    11 (cliente) + 44 (imobiliária) = 55 juntadas; 1 recusada (o documento do Corp já tinha origem do Bitrix). Sobram 553 propostas do Bitrix sem Corp.

-- 03/11/2026: erp_juntar_card_corp_par passa a mover só anexos cujo sha256 ainda não existe no documento do Corp
-- (evita erro 23505 em erp_documento_anexos_doc_sha_idx) e apaga os repetidos do card.
-- Critério da ligação em massa: seguradora + vigência + prêmio iguais E cliente/imobiliária iguais, sem CPF diferente,
-- escolha mútua e única. Primeira rodada: 1 par juntado (card 6732c826 -> doc 3c003561).

-- 03/11/2026 (hierarquia de acesso): funções SECURITY DEFINER de manutenção do ERP sem checagem interna (≈40, ex.: erp_juntar_card_corp_par,
-- erp_vinculo_*, erp_negocio_*, erp_baixa_erp_processar) tiveram EXECUTE revogado de public/anon/authenticated (ficam postgres + service_role).
-- erp_parcela_data_suspeita ganhou RLS (política só para is_colaborador_o2()). Funções novas desse tipo: revogar EXECUTE logo na criação.

-- 03/11/2026: todas as views erp_*/corp_*/nibo* passaram a security_invoker=true e perderam o acesso de anon
-- (antes 19 liam como dono, furando RLS, e estavam abertas a visitante). Views novas: criar já com security_invoker.

-- 03/11/2026: erp_portal_seguradora_leitura (seguradora, conta, numero_proposta único; numero_apolice, cpf_cnpj_cliente, vigencia_inicio, premio,
-- documento_id, casamento, fonte, nivel, lido_em; RLS só is_colaborador_o2). 1ª carga: portal da Pottencial (conta O2 Capitalização, 60 dias, 161 apólices).
-- Casamento: vigência exata + prêmio (líquido ou ×1,0738) + CPF do cliente. 48 cards Bitrix juntados ao documento do Corp (nº da apólice igual) e
-- 62 documentos receberam nº de apólice/proposta do portal. Sobraram 51 sem casamento (31 sem CPF confere, 19 sem documento no ERP, 1 duplicada Corp x Corp).
