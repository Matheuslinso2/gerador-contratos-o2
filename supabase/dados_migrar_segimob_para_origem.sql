-- A coluna cnpj_o2 (agora rotulada "Origem da fatura" na tela) ganhou uma
-- 3ª opção: SegImob -- plataforma terceirizada onde algumas faturas da
-- Tokio precisam ser buscadas, diferente de O2 Seguros/O2 Capitalização.
-- Antes disso só existia como um texto fixo no campo observação (import da
-- planilha 07-julho). Esse script move esses registros pro campo certo.

-- 1) Conferir quantas linhas serão migradas:
select id, seguradora, observacao, cnpj_o2
from faturas_esperadas
where observacao ilike '%segimob%' and coalesce(cnpj_o2, '') = '';

-- 2) Migra: define a origem como SegImob e limpa a observação (a
-- informação passa a viver no campo próprio, não precisa repetir em texto).
update faturas_esperadas
set cnpj_o2 = 'SegImob', observacao = null
where observacao ilike '%segimob%' and coalesce(cnpj_o2, '') = '';

-- 3) Conferência final:
select seguradora, cnpj_o2, count(*) from faturas_esperadas where cnpj_o2 = 'SegImob' group by seguradora, cnpj_o2;
