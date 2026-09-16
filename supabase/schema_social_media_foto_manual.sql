-- Foto pessoal opcional em posts de Social Media (pedido do Matheus,
-- 15/09/2026): em vez do card gerado automaticamente por next/og, dá pra
-- subir uma foto de verdade (dele, em evento, etc.) e usar ela na
-- publicação. Bucket público (mesmo padrão de "campanhas-imagens" --
-- Instagram/preview precisam de URL de verdade, não signed URL nem
-- data: URI), mas com policy explícita de INSERT/DELETE restrita à equipe
-- O2 (diferente de "campanhas-imagens", que foi criado manualmente sem
-- policy registrada em SQL).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media-fotos', 'social-media-fotos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "social-media-fotos insert o2"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'social-media-fotos' and (auth.jwt() ->> 'email') like '%@o2seguros.com.br');

create policy "social-media-fotos delete o2"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'social-media-fotos' and (auth.jwt() ->> 'email') like '%@o2seguros.com.br');

alter table social_media_posts add column if not exists imagem_manual_url text;
