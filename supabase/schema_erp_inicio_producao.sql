-- Painel de produção da aba Início do ERP, no critério do painel do Corp (Consultas > Gráficos de Análise e Metas > Produção Total). 02/11/2026.
-- Calibragem (grade_prods do Corp, sem linhas repetidas por produtor): DATA = início de vigência; Novos=NOVO, Renovações=RENV, Faturas=FAT, Endossos=END+CANC;
-- Prêmio Base = prêmio líquido; Comissão = valor da comissão; Qtde de Docs = documentos distintos (Nosso nº do Corp). Novembro/2026 bate ao centavo
-- (99 docs, 29.473,85, 10.571,83); out/set/ago batem em nº de docs. A grade do Corp repete a mesma linha uma vez por produtor (ex.: imobiliária + SEGIMOB): deduplicar
-- por (Nosso nº, Nº endosso, Tipo, Pr. líquido, Vl. com.) antes de somar. Variação do painel = contra o MESMO mês/ano do ano anterior. Meta = corp_meta_comissao.
-- Objetos (já aplicados no banco): view erp_producao_base_v; funções erp_inicio_producao(ano, mes, seguradora, produto, imobiliaria) e erp_inicio_ranking(...).
-- Código da função: ver a migração erp_inicio_producao_painel_corp no Supabase (histórico de migrações).
-- Ajuste (02/11, depois do mapa do painel do Corp feito pelo robô): filtros Seguradora, Ramo, Grupo de produtores (+ produto e imobiliária); Ranking = pizza de Seguradoras,
-- pizza de Ramos e barras de Produtores; funções erp_inicio_producao(..., p_ramo, p_canal, p_grupo) e erp_inicio_ranking(p_dim: seguradora|ramo|produtor, ...).
-- O Corp tem ainda Agente e Canal de Vendas (valores do Corp: FIANCA 2, IMOBILIÁRIO PRO LABORE): o ERP só guarda o canal de integração (Base Software, Superlógica, Segimob), então esses dois filtros ficam para depois.

-- 02/11 (2): painel soma só propostas efetivadas — com Nosso nº do Corp (ou origem api). Card do Bitrix sem nº do Corp ainda é proposta/cotação e fica fora.
-- view erp_producao_base_v: Novos/Renovações exigem (nosso_numero_corp is not null or origem = 'api'); faturas e endossos não.

-- 02/11 (3): regras do Power BI. View final: exclui fora_regra_pbi (linha que o PBI não conta na base corretora) e exige
-- (nosso_numero_corp is not null or origem = 'api') em TODOS os tipos. Out/26 conferido com corp_retrato_producao:
-- Novos corp_import 405 docs / R$ 1.466.201 (= PBI), Endossos+Cancelamentos prêmio -1.456 / com -621 (= PBI).
-- Importação de out/26 refeita: select erp_importar_corp('2026-10-01','2026-11-01', false) (sem regerar parcelas).

-- 03/11 (4): ERP independente do Corp. A view erp_producao_base_v passa a contar também a proposta efetivada do Bitrix (origem='bitrix',
-- situacao='proposta', NOVO/RENV) que ainda não tem Nosso nº do Corp, exceto se o mesmo negócio já estiver no Corp
-- (mesma seguradora, prêmio líquido ±1, início de vigência ±3 dias). Importação refeita: erp_importar_corp('2026-10-01','2027-01-01', false)
-- + parcelas/comissões estimadas só para documentos corp_import sem parcela (3.157 parcelas).
-- Pendência: propostas sem início de vigência (100 novos em out/2026) não entram em nenhum mês.

-- 03/11 (5): proposta do Bitrix sem Nosso nº do Corp só entra na produção COM PROVA de efetivação (Matheus: "se não tem a proposta, o arquivo,
-- não tem como verificar, a não ser que a seguradora ou a Segimob avisem por e-mail"). Prova = anexo do documento, e-mail de evidência de emissão,
-- PDF da proposta lido ou evidência em erp_proposta_acompanhamento. Sem prova = pendente, fora do painel.
