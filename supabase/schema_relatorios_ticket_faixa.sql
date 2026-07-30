-- Guarda o ticket médio por bairro/região e faixa de aluguel calculado no
-- momento da geração do relatório de prospecção (leitura das estatísticas
-- já pré-calculadas, ver prospeccaoEstatisticas.ts).

alter table relatorios_prospeccao add column if not exists ticket_por_faixa jsonb;
