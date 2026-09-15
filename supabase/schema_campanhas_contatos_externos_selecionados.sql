-- Espelha campanhas.imobiliarias_selecionadas, mas pra contatos externos
-- de prospecção (campanhas_grupos_contatos) -- uma campanha de prospecção
-- pode selecionar contatos externos, imobiliárias reais, ou os dois ao
-- mesmo tempo.
alter table campanhas add column if not exists contatos_externos_selecionados uuid[];
