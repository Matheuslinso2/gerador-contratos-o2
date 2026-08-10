-- Upload da grade de produção (.xlsx) direto do navegador pro Storage, mesmo
-- motivo dos outros buckets temporários: a Vercel tem teto de ~4,5 MB por
-- Server Action, e a grade de Imobiliário sozinha já passa de 20 mil linhas.
--
-- IMPORTANTE: antes de rodar o resto deste arquivo, crie manualmente no painel
-- do Supabase (Storage -> New bucket) um bucket chamado "producao-temp", com
-- "Public" DESLIGADO (mesmo padrão de "auditoria-temp"/"faturas-temp").

create policy "producao-temp select proprio"
on storage.objects for select
to authenticated
using (bucket_id = 'producao-temp' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "producao-temp insert proprio"
on storage.objects for insert
to authenticated
with check (bucket_id = 'producao-temp' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "producao-temp delete proprio"
on storage.objects for delete
to authenticated
using (bucket_id = 'producao-temp' and (storage.foldername(name))[1] = auth.uid()::text);
