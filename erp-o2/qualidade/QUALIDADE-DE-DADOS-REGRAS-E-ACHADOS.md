# Qualidade de dados do ERP/Workspace — regras, achados e triagem (criado em 07/11/2026)

Objetivo (Matheus): prevenir erros e bugs, não perder a qualidade dos dados nem a confiança no sistema. Inspirado no cap. 5 ("Bugs") do livro *Fundamentos de Manutenção de Software* (M. T. Valente): linters, registro com passos de reprodução, triagem (duplicado/inválido/real), correção, retrabalho (reabertura).

## Tabelas (migration `erp_qualidade_regras_achados_execucoes`; RLS ligado, sem política: só service_role / função)
- `erp_qualidade_regras(codigo, titulo, descricao, area, gravidade bloqueia|alerta|observa, sql_base, ativa)` — `sql_base` devolve `(chave, detalhe)` de cada ocorrência.
- `erp_qualidade_achados(regra_codigo, chave, detalhe, status novo|em_analise|falso_positivo|corrigido|reaberto, primeira_vez, ultima_vez, resolvido_em, observacao)` — único por (regra, chave).
- `erp_qualidade_execucoes(regra_codigo, rodou_em, ocorrencias, duracao_ms, erro)` — histórico para ver tendência.

## Rotina `erp_qualidade_rodar(p_regra text default null, p_limite_amostra int default 200)`
SECURITY DEFINER, guarda `auth.role()` + `revoke` de public/anon/authenticated (testado com perfil externo: "permission denied"). Trava `pg_try_advisory_xact_lock` (não roda duas ao mesmo tempo), `statement_timeout` de 20 s por regra, erro de uma regra não derruba as outras. Registra até 200 ocorrências por regra; achado que some (amostra completa) vira `corrigido`; se voltar, `reaberto`. Falso positivo marcado à mão é preservado.
Primeira rodada (07/11): 12 regras (inclui CARGA_CONTAGEM_DIVERGE e DOC_NOSSO_CORP_REPETIDO), 1–2 s cada. Correções no mesmo dia: hora do achado com clock_timestamp() (antes marcava "corrigido" por engano) e amostra ordenada por chave (estável entre rodadas).

## Regras iniciais (ocorrências em 07/11)
CARGA_CONTAGEM_DIVERGE 1 (alerta; Clientes: esperado 106.896, gravado 106.968) · DOC_NOSSO_CORP_REPETIDO 0 (bloqueia) · DOC_VIG_FIM_ANTES_INICIO 2 (bloqueia) · DOC_SEM_VIGENCIA_INICIO 309 · DOC_SEM_SEGURADORA 42 · DOC_APOLICE_REPETIDA 3.405 (alerta) · DOC_PREMIO_ZERO 18.978 · DOC_PARCELAS_QTD_DIVERGE 5.106 · PARCELA_VALOR_ZERO 5.569 · COTACAO_CREDITO_ATIPICO 4 (observa) · PARCELA_SEM_DOCUMENTO 0 · PORTAL_DOC_INEXISTENTE 0 (bloqueia). Números altos são SINAIS para triar, não erros confirmados.

## Como agendar
Sem pg_cron no projeto. Agendar por cron do app (vercel.json) chamando a função com service role, FORA de :40–:59 (incidente 04/11). Isso mexe no código do app: proposta ao centro.

## Próximos passos
Mais regras (cobertura por mês, vínculos cotação→proposta→apólice, duplicidade de negócio, datas trocadas), indicador de confiança no painel, e validação na entrada (telas/importações) — essas duas últimas são do centro.
