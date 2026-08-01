-- Permite o tipo 'renovacao' em cotacoes_cache (renovação de fiança —
-- fluxo separado de uma cotação nova, mas guardado no mesmo cache pra
-- reaproveitar toda a lógica de dashboard por produto).

alter table cotacoes_cache drop constraint if exists cotacoes_cache_tipo_check;
alter table cotacoes_cache add constraint cotacoes_cache_tipo_check
  check (tipo in ('incendio', 'fianca', 'renovacao'));
