-- Corrige as fontes de notícia cadastradas em schema_social_media.sql: 3
-- das 5 URLs estavam erradas (404) e a do InfoMoney, embora respondesse,
-- é uma categoria do site que não publica nada há tempos (feed vazio).
-- Testei os feeds abaixo um por um (curl) antes de trocar.

-- Remove as fontes quebradas.
delete from social_media_fontes
where url_rss in (
  'https://www.infomoney.com.br/minhas-financas/feed/',
  'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/economia/',
  'https://cnseg.org.br/noticias/feed',
  'https://www.segs.com.br/rss/noticias.xml'
);

-- Fontes que testei e confirmei com notícias de verdade no feed.
insert into social_media_fontes (nome, url_rss, categoria) values
  ('InfoMoney', 'https://www.infomoney.com.br/feed/', 'mercado_imobiliario'),
  ('Exame', 'https://exame.com/feed/', 'mercado_imobiliario'),
  ('Money Times', 'https://www.moneytimes.com.br/feed/', 'mercado_imobiliario'),
  ('Sonho Seguro', 'https://sonhoseguro.com.br/feed/', 'seguro_imobiliario'),
  ('CQCS - Correio de Seguros', 'https://cqcs.com.br/feed/', 'seguro_imobiliario'),
  ('Revista Apólice', 'https://www.revistaapolice.com.br/feed/', 'seguro_imobiliario')
on conflict (url_rss) do nothing;
