-- Apaga os 6 pendentes duplicados (BSJ, JSJ, TDC, TWP) -- os registros
-- reais já existem com nome completo e os dados corretos (conferido antes
-- de rodar isso). Isso é o que explicava as 121 linhas na Tokio em vez de
-- 115: 115 + 6 duplicatas = 121.

delete from faturas_esperadas
where nome_provisorio in ('BSJ', 'JSJ', 'TDC', 'TWP')
  and imobiliaria_id is null;

-- Conferência: Tokio deve voltar pra 115.
select count(*) from faturas_esperadas where seguradora = 'TOKIO' and ativo = true;
