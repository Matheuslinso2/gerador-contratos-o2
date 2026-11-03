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

-- 03/11 (6) VERSÃO FINAL: o total do painel volta a ser o do Power BI/Corp — só documento com Nosso nº do Corp (nosso_numero_corp is not null).
-- Proposta do Bitrix e documento da API sem Corp inflavam: out/26 comissão ERP 632 mil x PBI 459 mil; set/26 694 mil x 548,6 mil (Matheus apontou).
-- Depois da correção: out/26 463 mil x 459 mil; set/26 544 mil x 548,6 mil. As propostas efetivadas sem Corp devem aparecer à parte (a definir).

-- 03/11 (7): proposta efetivada já conta no faturamento do Início, UMA vez só (Matheus). Migration erp_producao_com_propostas.
--  * erp_producao_base_v (conta='corp'): só documentos com Nosso nº do Corp (igual ao Power BI). erp_producao_propostas_v (conta='proposta'): card do Bitrix em 'proposta'
--    ou documento da API, sem Nosso nº, sem equivalente no Corp (mesma seguradora, prêmio líquido ±1, início ±3 dias). erp_producao_total_v = união.
--  * erp_inicio_producao(..., p_propostas boolean default true) e erp_inicio_ranking(..., p_propostas default true) leem erp_producao_total_v; p_propostas=false = só Corp/Power BI.
--    O retorno ganhou propostas_mensal (docs/base/com por mês) e com_propostas.
--  * Cada documento é uma linha de erp_documentos: quando o Corp cadastrar, o MESMO documento ganha o Nosso nº e passa de conta 'proposta' para 'corp' (sem somar duas vezes);
--    card duplicado de um documento do Corp fica 'duplicado' (fora da conta).
--  * Painel: pílulas "Com propostas" (padrão) / "Só Corp / Power BI" (?prop=corp) e aviso amarelo com o que vem de proposta no período.
--  Comissão por mês, só Corp / com propostas: ago 564k/581k, set 544k/682k, out 463k/628k, nov 10,6k/51k.

-- 03/11 (8): migration erp_producao_propostas_sem_duplicar. Ou é proposta ou é apólice (Matheus): o mesmo seguro não pode contar duas vezes.
--  * erp_producao_propostas_v ganhou conta 'proposta' (limpa: sem nenhum candidato no Corp) ou 'duvida' (existe documento do Corp da mesma seguradora e tipo, início ±30 dias, ainda sem card ligado,
--    com mesma imobiliária, mesmo cliente ou prêmio líquido dentro de 15%). erp_producao_total_v = corp + 'proposta'; 'duvida' fica FORA do total até o vínculo (erp_producao_duvida_v).
--  * erp_inicio_producao devolve duvida_mensal. Comissão: ago corp 564k + 13k prop (47k em dúvida); set 544k + 49k (186k em dúvida); out 463k + 76k (181k em dúvida); nov 10,6k + 6k (34k em dúvida).
