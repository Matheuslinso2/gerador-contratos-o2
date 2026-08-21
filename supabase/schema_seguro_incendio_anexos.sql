-- Bucket de anexos da landing page /seguro-incendio (planilha de itens do
-- fluxo Imobiliário). Aplicado direto no projeto via MCP -- este arquivo é
-- só o registro, mesmo padrão de schema_seguro_auto_anexos.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seguro-incendio-anexos',
  'seguro-incendio-anexos',
  false,
  104857600,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv','application/vnd.oasis.opendocument.spreadsheet','application/pdf']
)
on conflict (id) do nothing;

-- Ficha pública (sem login) precisa enviar a planilha direto do navegador
-- pro Storage -- o corpo de uma Server Action na Vercel tem teto de ~4,5MB.
-- Só INSERT pro anon, sem SELECT/UPDATE/DELETE.
create policy "seguro-incendio-anexos insert publico"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'seguro-incendio-anexos');
