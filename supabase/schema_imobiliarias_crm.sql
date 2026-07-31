-- Dados do CRM (Bitrix24) que enriquecem o registro de imobiliárias
-- conhecidas: classificação/responsável (pra saber se já tem alguém
-- cuidando da conta) e quantidade de imóveis (usada no cálculo de
-- potencial bruto do relatório de prospecção).

alter table imobiliarias_conhecidas add column if not exists classificacao_crm text;
alter table imobiliarias_conhecidas add column if not exists responsavel_crm text;
alter table imobiliarias_conhecidas add column if not exists quantidade_imoveis integer;
