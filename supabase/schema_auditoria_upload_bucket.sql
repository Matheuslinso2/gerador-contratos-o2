-- O envio de arquivos pro Auditor (contrato e cotação) passou a ir direto do
-- navegador pro Storage, em vez de passar pelo corpo da Server Action —
-- a Vercel tem um teto rígido de ~4,5 MB por requisição de função, que
-- contratos escaneados (com fotos de laudo) passam fácil. Os arquivos aqui
-- são temporários: o servidor baixa, extrai o texto e apaga em seguida.
--
-- IMPORTANTE: antes de rodar o resto deste arquivo, crie manualmente no painel
-- do Supabase (Storage -> New bucket) um bucket chamado "auditoria-temp", com
-- "Public" DESLIGADO (mesmo padrão do bucket "laudos").

create policy "auditoria-temp select proprio"
on storage.objects for select
to authenticated
using (bucket_id = 'auditoria-temp' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "auditoria-temp insert proprio"
on storage.objects for insert
to authenticated
with check (bucket_id = 'auditoria-temp' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "auditoria-temp delete proprio"
on storage.objects for delete
to authenticated
using (bucket_id = 'auditoria-temp' and (storage.foldername(name))[1] = auth.uid()::text);
