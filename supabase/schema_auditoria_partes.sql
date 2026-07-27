-- Guarda locador/locatário/endereço extraídos pela IA na auditoria, pra
-- poder mostrar o mesmo resumo enxuto (locador × locatário — endereço) que
-- já usamos nos contratos gerados, e pra poder buscar por eles.

alter table auditorias_contrato add column if not exists locador_identificado text;
alter table auditorias_contrato add column if not exists locatario_identificado text;
alter table auditorias_contrato add column if not exists endereco_identificado text;
