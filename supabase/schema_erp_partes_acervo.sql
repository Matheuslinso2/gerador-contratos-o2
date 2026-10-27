-- ERP O2 — partes da apólice do acervo (27/10/2026). Aplicado via MCP (migrations erp_docs_por_partes_papeis_fianca*, erp_doc_partes_acervo_pronta, erp_docs_por_partes_usa_tabela_pronta).
-- Fiança (10 apólices reais lidas: Porto, Pottencial, Tokio, Too): Segurado = Locador = PROPRIETÁRIO (contratante, CPF explícito);
-- Garantido = LOCATÁRIO (inquilino); Estipulante = imobiliária. Corrige o filtro de 25/10, que tratava garantido como proprietário.
-- erp_doc_partes_acervo (documento_id, papel segurado|garantido, locatario_id): tabela pronta de apolice_partes × erp_documentos (nosso_numero_corp),
--   só produto fianca; recalculada por erp_atualizar_partes_acervo() no cron /api/cron/erp-faturas (xx:50). RLS: is_colaborador_o2().
-- erp_docs_por_partes(inquilino, proprietario, imovel, limite): inquilino = cliente do documento + item locatario/garantido + garantido do acervo;
--   proprietário = item proprietario + segurado do acervo. Medido: nome completo ~75 ms; primeiro nome+sobrenome comum ~0,7–1 s.

-- 27/10/2026 — junção card do Bitrix × documento do Corp (migration erp_juntar_cards_corp).
-- erp_documentos.situacao ganhou 'duplicado' (documento do card já juntado ao do Corp; nunca apagado, fora das listas por padrão).
-- erp_juntar_cards_corp(p_dias int=13, p_aplicar bool=false): casa card concluído (digitado, origem bitrix) com documento do Corp (mesmo locatário,
--   início de vigência a até p_dias, 1 para 1, Corp ainda sem card). Aplicado em 27/10: 47 pares (34 com a mesma vigência, máx. 12 dias).
--   Ao aplicar: chave externa, origem, itens, e-mails, anexos e eventos passam para o documento do Corp; o do card vira 'duplicado'.
--   Ficaram fora, para decisão do Matheus: 12 pares com vigência >= 14 dias de diferença e o 2º card do Renato Santos de Oliveira (L3).

-- 27/10/2026 — etapa Emissão (migrations erp_emissao_fila_e_kpis, erp_emissao_tabelas_prontas, erp_emissao_kpis_*).
-- Proposta pendente = situacao 'digitado' sem numero_apolice e sem numero_endosso. dt_emissao está vazia no Corp e no Bitrix: o nº prova a emissão.
-- erp_emissao_fila (view, security_invoker) → erp_emissao_fila_pronta (tabela, RLS select colaborador). Data da efetivação = último evento de
--   sucesso do card no Bitrix; sem card, dt_proposta do Corp; por último vigencia_inicio.
-- erp_emissao_kpis(mes) → erp_emissao_kpis_pronta (6 meses): efetivados, emitidos (têm nº), pendentes (digitado sem nº), encerradas_sem_numero, bitrix, corp.
-- erp_atualizar_emissao() recalcula as duas tabelas; chamada pelo cron /api/cron/erp-faturas (xx:50). Índice erp_documentos_dtproposta_idx.

-- 27/10/2026 — Início com KPIs do mês (migrations erp_inicio_kpis, erp_inicio_kpis_sinistro_abertura).
-- erp_inicio_kpis(mes) → erp_inicio_kpis_pronta (3 meses; erp_atualizar_inicio() no cron erp-faturas): faturas (itens, entram/saem/ficam entre o mês e o
--   anterior da mesma fatura, boletos que não batem), parcelas, baixa (erp_corp_comissoes: recebida × pendente, última baixa), apólices, sinistros
--   (abertura pela data da seguradora; created_at é a data da carga) e renovações. Descoberta: erp_corp_comissoes.dt_emissao tem a data de emissão do Corp
--   para ~51 mil documentos (há valores absurdos, ex.: 2076): candidata à data de emissão do ERP, depois de limpar.
