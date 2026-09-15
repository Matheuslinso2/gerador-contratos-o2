-- Arquivamento de campanhas (pedido do Matheus, 15/09/2026): tira do
-- radar do dia a dia sem excluir -- diferente de excluirCampanha, que
-- apaga de vez (inclusive histórico de envios/produção). Nulo = ativa.
alter table campanhas add column if not exists arquivada_em timestamptz;
