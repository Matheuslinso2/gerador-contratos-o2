-- Aba unificada "Contratos realizados": guarda o texto analisado na auditoria
-- (hoje ele era descartado depois da chamada à IA) para dar para buscar por
-- CPF/nome também entre os contratos auditados, não só nos gerados.

alter table auditorias_contrato add column if not exists texto_contrato text;
