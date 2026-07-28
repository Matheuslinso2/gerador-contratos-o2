-- "locador"/"locatario" guardam a qualificação jurídica completa (nome, RG,
-- CPF, endereço), necessária dentro do texto do contrato — mas isso deixa o
-- resumo da listagem poluído. Adiciona colunas só com o(s) nome(s), no mesmo
-- padrão enxuto que o Auditor já usa (locador_identificado/locatario_identificado),
-- para exibição e busca na lista de contratos gerados/realizados.

alter table contratos add column if not exists locador_nomes text;
alter table contratos add column if not exists locatario_nomes text;
