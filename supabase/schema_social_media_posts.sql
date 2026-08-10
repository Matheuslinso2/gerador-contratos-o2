-- Fase 2 do Social Media automático: rascunhos de post gerados por IA a
-- partir de uma notícia coletada (social_media_noticias) ou de um tema
-- institucional livre. Nada aqui publica sozinho ainda — isso é Fase 4.

create table if not exists social_media_posts (
  id bigint generated always as identity primary key,
  noticia_id bigint references social_media_noticias(id) on delete set null,
  tema_institucional text,
  categoria text not null check (categoria in ('mercado_imobiliario', 'seguro_imobiliario', 'institucional')),
  titulo_card text not null,
  legenda text not null,
  status text not null default 'rascunho' check (status in ('rascunho', 'agendado', 'publicado', 'erro')),
  criado_em timestamptz not null default now(),
  publicado_em timestamptz,
  instagram_post_id text,
  erro text,
  constraint social_media_posts_origem check (noticia_id is not null or tema_institucional is not null)
);

create index if not exists social_media_posts_status_idx on social_media_posts (status, criado_em desc);

alter table social_media_posts enable row level security;

drop policy if exists "social_media_posts acesso o2" on social_media_posts;
create policy "social_media_posts acesso o2"
on social_media_posts for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
