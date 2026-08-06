-- Cria como pendentes (nome_provisorio, sem CNPJ ainda) os 15 parceiros que
-- não tinham NENHUM registro no sistema (nem certo, nem provisório) --
-- já com vencimento/origem/observação da planilha, prontos pra vincular o
-- CNPJ/CPF depois pelo botão "Editar".

insert into faturas_esperadas (seguradora, nome_provisorio, codigo_produtor, dia_vencimento, cnpj_o2, observacao, ativo)
values
  ('PORTO FIANÇA', 'BSJ', '', 10, 'O2 Seguros', NULL, true),
  ('PORTO FIANÇA', 'GQT', '', 10, 'O2 Seguros', NULL, true),
  ('PORTO FIANÇA', 'TAGS IMOVEIS', '', 10, 'O2 Seguros', NULL, true),
  ('PORTO RE', 'TIAGO SANTOS STORTI', '', 15, 'O2 Seguros', NULL, true),
  ('POTTENCIAL', 'BSJ', '', 15, NULL, NULL, true),
  ('POTTENCIAL', 'I9', '', 15, NULL, 'ENVIAR WPP TAMBÉM', true),
  ('POTTENCIAL', 'RDJ', '', 15, NULL, NULL, true),
  ('TOKIO', 'BSJ', '', 21, 'SegImob', NULL, true),
  ('TOKIO', 'FLAVIO BRAGA MONTEIRO', '', 15, 'SegImob', NULL, true),
  ('TOKIO', 'JSJ', '', 15, 'SegImob', NULL, true),
  ('TOKIO', 'RDJ', '', 15, 'SegImob', NULL, true),
  ('TOKIO', 'TDC', '', 20, 'O2 Seguros', NULL, true),
  ('TOKIO', 'TWP', '', 15, 'SegImob', NULL, true),
  ('TOO', 'JGM', '', NULL, 'O2 Capitalização', NULL, true),
  ('TOO', 'TIAGO SANTOS', '', NULL, 'O2 Capitalização', NULL, true)
on conflict (nome_provisorio, seguradora, codigo_produtor) do nothing;

-- Conferência:
select seguradora, nome_provisorio, dia_vencimento, cnpj_o2 from faturas_esperadas where nome_provisorio in ('BSJ', 'GQT', 'TAGS IMOVEIS', 'TIAGO SANTOS STORTI', 'I9', 'RDJ', 'FLAVIO BRAGA MONTEIRO', 'JSJ', 'TDC', 'TWP', 'JGM', 'TIAGO SANTOS') order by seguradora, nome_provisorio;
