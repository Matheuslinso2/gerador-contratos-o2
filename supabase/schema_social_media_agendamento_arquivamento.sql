-- Aba de arquivadas + agendamento de publicação (pedido do Matheus,
-- 16/09/2026): com o tempo os rascunhos/publicados vão poluir a tela
-- principal do Social Media. Arquivar tira o post do radar sem apagar nada
-- (mesmo padrão de campanhas.arquivada_em). agendado_para permite marcar
-- uma publicação pra sair sozinha mais tarde -- o status 'agendado' já
-- existia no check constraint original de social_media_posts, só nunca
-- tinha sido usado; quem dispara de fato é o cron novo
-- (src/app/api/cron/publicar-social-media/route.ts).

alter table social_media_posts add column if not exists arquivado_em timestamptz;
alter table social_media_posts add column if not exists agendado_para timestamptz;
