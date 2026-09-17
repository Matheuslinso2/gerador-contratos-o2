-- Adiciona suporte a posts em carrossel (4-5 imagens resumindo uma ideia
-- geral), como alternativa ao post de imagem única já existente.
-- Já aplicada em produção via MCP do Supabase (migração
-- "social_media_carrossel") em 17/09/2026 -- este arquivo é só o registro
-- no repo, seguindo o padrão dos outros schema_*.sql.

-- Quando preenchida, guarda o array de textos de cada slide (4 a 5 itens)
-- e o post passa a ser publicado como carrossel no Instagram em vez de
-- imagem única. Quando null, o post continua seguindo o fluxo antigo
-- (tipo_post + numero_destaque definem o layout de imagem única).
alter table social_media_posts add column if not exists slides jsonb;
