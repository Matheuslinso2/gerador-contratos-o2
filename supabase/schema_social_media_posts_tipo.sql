-- Classifica cada post em um de 5 tipos visuais (a IA escolhe ao gerar o
-- conteúdo, em src/lib/social/gerarConteudo.ts) — determina qual layout de
-- imagem é usado em src/app/api/social/imagem/[postId]/route.tsx.
-- numero_destaque só é preenchido quando tipo_post = 'dado_mercado'.

alter table social_media_posts
  add column if not exists tipo_post text
    check (tipo_post in (
      'dica_mercado',
      'atualizacao_tecnologia',
      'apresentacao_produto',
      'dado_mercado',
      'autoridade_pessoal'
    )),
  add column if not exists numero_destaque text;
