-- Marca imobiliárias criadas automaticamente pelo módulo de Faturas (via
-- resolverOuCriarImobiliaria) quando identifica uma fatura de uma
-- imobiliária que ainda não tinha registro em `imobiliarias`. Esses
-- registros nascem sem texto de contrato, índice de reajuste ou
-- percentuais configurados -- não servem pra gerar contrato ainda, só
-- existem pra a fatura ter uma imobiliária pra apontar.

alter table imobiliarias add column if not exists cadastro_incompleto boolean not null default false;

-- Backfill: registros que já existem hoje sem contrato configurado E sem
-- índice de reajuste são quase certamente cascas criadas pelo Faturas
-- antes dessa coluna existir (o fluxo normal de cadastro do Gerar
-- Contrato sempre preenche esses dois campos).
update imobiliarias
set cadastro_incompleto = true
where coalesce(texto_base_contrato, '') = ''
  and coalesce(indice_reajuste, '') = '';
