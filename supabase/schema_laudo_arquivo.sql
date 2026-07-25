-- Laudo de vistoria: além do link (já existente em laudo_vistoria_url), agora dá pra
-- anexar o laudo como arquivo (PDF, imagem, Word). Ele nunca é reaproveitado/reescrito —
-- fica guardado do jeito que foi enviado.
--
-- laudo_modo indica o que fazer com ele no contrato final:
--   'nenhum'            -> não tem laudo nesta locação
--   'link'              -> usa laudo_vistoria_url (já existia)
--   'arquivo_separado'  -> arquivo original fica disponível para baixar à parte;
--                          no contrato entra só uma cláusula citando o anexo
--   'arquivo_embutido'  -> arquivo (precisa ser PDF) é colado como páginas finais
--                          do contrato, na versão em PDF completo

alter table contratos add column if not exists laudo_modo text not null default 'nenhum';
alter table contratos add column if not exists laudo_arquivo_path text;
alter table contratos add column if not exists laudo_arquivo_nome text;

-- IMPORTANTE: antes de rodar o resto deste arquivo, crie manualmente no painel do
-- Supabase (Storage -> New bucket) um bucket chamado "laudos", com "Public" DESLIGADO
-- (diferente do bucket "logos", que é público). O laudo pode conter dados pessoais
-- do inquilino e fotos do imóvel, então só o dono da conta pode ler/gravar o próprio.

create policy "laudos select proprio"
on storage.objects for select
to authenticated
using (bucket_id = 'laudos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "laudos insert proprio"
on storage.objects for insert
to authenticated
with check (bucket_id = 'laudos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "laudos delete proprio"
on storage.objects for delete
to authenticated
using (bucket_id = 'laudos' and (storage.foldername(name))[1] = auth.uid()::text);
