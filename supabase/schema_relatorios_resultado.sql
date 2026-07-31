-- Registro do resultado da visita (preenchido depois, não na criação do
-- relatório) — fecha o ciclo de prospecção: temperatura, estágio, próximo
-- passo combinado. Mesmo vocabulário usado nos relatórios comerciais da O2.

alter table relatorios_prospeccao add column if not exists resultado_temperatura text;
alter table relatorios_prospeccao add column if not exists resultado_estagio text;
alter table relatorios_prospeccao add column if not exists resultado_proximo_passo text;
alter table relatorios_prospeccao add column if not exists resultado_data_proximo_passo date;
alter table relatorios_prospeccao add column if not exists resultado_observacoes text;
alter table relatorios_prospeccao add column if not exists resultado_atualizado_em timestamptz;

-- Retrato (no momento da geração) dos dados de CRM da imobiliária e do
-- potencial bruto estimado — evita ter que recruzar com o registro
-- imobiliarias_conhecidas toda vez que o relatório for reaberto.
alter table relatorios_prospeccao add column if not exists crm_classificacao text;
alter table relatorios_prospeccao add column if not exists crm_responsavel text;
alter table relatorios_prospeccao add column if not exists quantidade_imoveis integer;
alter table relatorios_prospeccao add column if not exists potencial_bruto_mensal numeric;
