-- Lógica invertida de criação de campanha (pedido da reunião de 15/09/2026):
-- a seleção de destinatários vira uma etapa salva na própria campanha, feita
-- ANTES de existir botão de disparo -- não mais um passo que já leva direto
-- pra revisão/envio.
alter table campanhas add column if not exists imobiliarias_selecionadas uuid[];
