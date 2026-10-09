-- Métricas de desempenho de cada post publicado (curtidas, comentários,
-- alcance, visualizações, salvamentos, compartilhamentos), buscadas na API
-- do Instagram e usadas pelo dashboard em /social-media/dashboard.
-- Já aplicada em produção via MCP do Supabase (migração
-- "social_media_metricas") em 09/10/2026 -- este arquivo é só o registro no
-- repo, seguindo o padrão dos outros schema_*.sql.

alter table social_media_posts add column if not exists metricas jsonb;
alter table social_media_posts add column if not exists metricas_atualizadas_em timestamptz;
