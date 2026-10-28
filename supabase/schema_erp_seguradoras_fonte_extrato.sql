-- ERP O2 — onde está o extrato de comissão de cada seguradora (28/10/2026). Aplicado via MCP (migration erp_seguradoras_fonte_extrato).
-- extrato_fonte: de onde a Nathalie/robô obtém; extrato_formato: PDF|XLS; extrato_lido_erp: portal|drive|gmail|nao (o que o ERP já lê);
-- extrato_obs: regras especiais (ex.: Pottencial, demonstrativo unificado e nota fiscal). Fonte: manual de baixa (Drive) + Matheus.
-- Pendência: Liberty não existe em erp_seguradoras (aparece no Nibo e no manual); Yelum, Itaú e Sompo a confirmar.
alter table erp_seguradoras
  add column if not exists extrato_fonte text,
  add column if not exists extrato_formato text,
  add column if not exists extrato_lido_erp text,
  add column if not exists extrato_obs text;
