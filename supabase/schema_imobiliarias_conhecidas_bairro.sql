-- Adiciona o bairro ao registro de imobiliárias conhecidas — usado pra
-- sugerir automaticamente o bairro/região de atuação na Prospecção quando o
-- colaborador não souber informar.

alter table imobiliarias_conhecidas add column if not exists bairro text;
