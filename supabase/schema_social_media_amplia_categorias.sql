-- Amplia o escopo do Social Media pra além de imóvel: seguro auto, seguro
-- saúde/planos de saúde, dados de prêmios/estatística de seguros (Susep) e
-- economia do país e do mundo. Antes só existiam mercado_imobiliario e
-- seguro_imobiliario -- agora ganham seguro_geral e economia.
-- Já aplicada em produção via MCP do Supabase (migração
-- "social_media_amplia_categorias") em 17/09/2026 -- este arquivo é só o
-- registro no repo, seguindo o padrão dos outros schema_*.sql.

alter table social_media_fontes drop constraint social_media_fontes_categoria_check;
alter table social_media_fontes add constraint social_media_fontes_categoria_check
  check (categoria in ('mercado_imobiliario', 'seguro_imobiliario', 'seguro_geral', 'economia'));

alter table social_media_posts drop constraint social_media_posts_categoria_check;
alter table social_media_posts add constraint social_media_posts_categoria_check
  check (categoria in ('mercado_imobiliario', 'seguro_imobiliario', 'seguro_geral', 'economia', 'institucional'));

-- As 4 fontes originais (G1, InfoMoney geral, Exame, Money Times) eram
-- feeds de economia geral, não de mercado imobiliário de fato -- foi o que
-- causava a sensação de "só sai seguro": reclassifica pro novo balde certo.
update social_media_fontes
set categoria = 'economia'
where nome in ('G1 - Economia', 'InfoMoney', 'Exame', 'Money Times');

-- Fonte de verdade especializada em mercado imobiliário (testada: traz
-- notícia real de imóvel, não economia genérica).
insert into social_media_fontes (nome, url_rss, categoria) values
  ('InfoMoney - Mercado Imobiliário', 'https://www.infomoney.com.br/tudo-sobre/mercado-imobiliario/feed/', 'mercado_imobiliario')
on conflict (url_rss) do nothing;

-- Seguro geral: auto, saúde/plano de saúde, estatística oficial (Susep) e
-- seguros em geral (vida, viagem, residencial fora do escopo de locação).
insert into social_media_fontes (nome, url_rss, categoria) values
  ('InfoMoney - Seguro Auto', 'https://www.infomoney.com.br/tudo-sobre/seguro-auto/feed/', 'seguro_geral'),
  ('InfoMoney - Plano de Saúde', 'https://www.infomoney.com.br/tudo-sobre/plano-de-saude/feed/', 'seguro_geral'),
  ('InfoMoney - Susep', 'https://www.infomoney.com.br/tudo-sobre/susep/feed/', 'seguro_geral'),
  ('InfoMoney - Seguros', 'https://www.infomoney.com.br/tudo-sobre/seguros/feed/', 'seguro_geral')
on conflict (url_rss) do nothing;

-- Economia do país e do mundo -- Agência Brasil complementa os 4 feeds
-- reclassificados acima com uma fonte oficial/governamental.
insert into social_media_fontes (nome, url_rss, categoria) values
  ('Agência Brasil - Economia', 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml', 'economia')
on conflict (url_rss) do nothing;
