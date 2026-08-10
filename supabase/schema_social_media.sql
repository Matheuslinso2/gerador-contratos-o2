-- Social Media automático: coleta notícias de mercado imobiliário e seguros
-- via RSS (social_media_fontes → social_media_noticias), depois (Fase 2+)
-- gera posts com IA e publica no Instagram. Fase 1 cobre só a coleta.
--
-- Fontes cadastradas na tabela, não no código — dá pra ligar/desligar ou
-- adicionar feed novo direto no Supabase, sem precisar de deploy.

create table if not exists social_media_fontes (
  id bigint generated always as identity primary key,
  nome text not null,
  url_rss text not null unique,
  categoria text not null check (categoria in ('mercado_imobiliario', 'seguro_imobiliario')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists social_media_noticias (
  id bigint generated always as identity primary key,
  fonte_id bigint not null references social_media_fontes(id) on delete cascade,
  titulo text not null,
  link text not null unique,
  resumo text,
  publicado_em timestamptz,
  coletado_em timestamptz not null default now(),
  usado boolean not null default false
);

create index if not exists social_media_noticias_usado_idx on social_media_noticias (usado, coletado_em desc);

alter table social_media_fontes enable row level security;
alter table social_media_noticias enable row level security;

-- Acesso interno O2 (leitura/edição pela equipe via app) — mesmo padrão de
-- schema_seguro_fianca.sql. A escrita da coleta em si roda pelo cron via
-- service role, que ignora RLS.
drop policy if exists "social_media_fontes acesso o2" on social_media_fontes;
create policy "social_media_fontes acesso o2"
on social_media_fontes for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "social_media_noticias acesso o2" on social_media_noticias;
create policy "social_media_noticias acesso o2"
on social_media_noticias for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

-- Fontes iniciais (edite/adicione direto na tabela depois). Todas com feed
-- RSS público, sem necessidade de chave de API.
insert into social_media_fontes (nome, url_rss, categoria) values
  ('InfoMoney - Minhas Finanças', 'https://www.infomoney.com.br/minhas-financas/feed/', 'mercado_imobiliario'),
  ('G1 - Economia', 'https://g1.globo.com/rss/g1/economia/', 'mercado_imobiliario'),
  ('Estadão - Economia', 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/economia/', 'mercado_imobiliario'),
  ('CNseg - Notícias', 'https://cnseg.org.br/noticias/feed', 'seguro_imobiliario'),
  ('Segs - Portal do Mercado de Seguros', 'https://www.segs.com.br/rss/noticias.xml', 'seguro_imobiliario')
on conflict (url_rss) do nothing;
