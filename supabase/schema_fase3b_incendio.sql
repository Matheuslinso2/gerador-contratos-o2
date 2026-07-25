-- Correção: seguro incêndio não é uma alternativa de garantia, é um item separado e paralelo.
-- Adiciona um segundo "slot" de produto no contrato, específico para seguro incêndio.

alter table contratos add column if not exists seguro_incendio_produto_id uuid references produtos(id);
