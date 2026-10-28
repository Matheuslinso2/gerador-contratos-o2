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

-- 27/10/2026 — ficha completa (item 4). erp_cliente_kpis(pessoa): todo o histórico do titular (segurado do Fiança via erp_doc_partes_acervo, ou o cliente do
-- documento): documentos, vigentes, produtos, prêmio total e comissão. Repasse por parcela calculado no código (src/lib/erp/repasseParcelas.ts):
-- percentual em parcelas iguais; repasse FIXO (percentual 0 e valor > 0; 1.231 linhas, média R$ 68) pago uma única vez, na 1ª parcela; dia 15 do mês seguinte.
-- Todas as linhas de erp_documento_produtores têm forma_repasse 'parcelado'; o fixo é detectado pelo percentual zero com valor.

-- 27/10/2026 — cadastro de clientes como no Corp (migrations erp_vincular_clientes, locatarios_codigo_cliente, locatarios_cadastro_incompleto, erp_clientes_resumo).
-- locatarios (compartilhada com o Workspace de contratos) ganhou: codigo_cliente (sequência, único, CLI-000001, todos os 37.176 cadastros), cadastro_incompleto
-- (coluna calculada: sem CPF/CNPJ de 11/14 dígitos ou sem e-mail e sem telefone; 15.776 hoje). Regra do cadastro novo: CPF/CNPJ válido (dígitos verificadores)
-- sempre + e-mail ou telefone. erp_vincular_clientes(aplicar) fez o backfill (1.044 docs do Corp por CPF, 117 partes, 164 clientes novos criados).
-- erp_clientes_resumo (1 linha) guarda total/incompletos, atualizada por erp_atualizar_clientes_resumo() no cron erp-faturas. O sincronizador do Bitrix
-- (bitrixOrigem.ts) passou a criar/ligar toda parte com CPF/CNPJ válido (src/lib/erp/clientes.ts: garantirCliente).

-- 28/10/2026 — tela Imobiliárias do ERP (migrations erp_imobiliarias_resumo, erp_imobiliaria_producao). Pedido do Matheus: a base de imobiliárias é a MESMA do
-- Workspace, do ERP e do Power BI; a tela do ERP mostra o que é pertinente à gestão. Só leitura; nada altera a base única.
-- erp_imobiliarias_resumo (por imobiliária): documentos, vigentes, prêmio/comissão vigente, produtos, seguradoras, propostas pendentes de emissão, faturas e
--   seguradoras com fatura; recalculada por erp_atualizar_imobiliarias_resumo() no cron erp-faturas (depois da fila de Emissão).
-- erp_imobiliaria_producao(id): produção vigente por produto e seguradora. Índice erp_documentos_imob_principal_idx.
-- Achado: imobiliarias.fatura_habilitada está FALSE para as 705 fichas, embora 135 tenham fatura no ERP: a tela passou a derivar "fatura" de erp_faturas.
