-- Bucket de anexos da landing page /seguro-auto (CNH, CRLV, apólice atual).
-- Aplicado direto no projeto via MCP em 18/08/2026 -- este arquivo é só o
-- registro, mesmo padrão dos outros schema_*.sql do repo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seguro-auto-anexos',
  'seguro-auto-anexos',
  false,
  104857600,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

-- Ficha pública (sem login) precisa enviar arquivo direto do navegador pro
-- Storage -- o corpo de uma Server Action na Vercel tem teto de ~4,5MB,
-- muito abaixo dos até 100MB aceitos aqui (CNH). Só INSERT pro anon, sem
-- SELECT/UPDATE/DELETE -- ninguém lista ou lê de volta o que outro
-- visitante enviou, só quem tem a service role (backoffice).
create policy "seguro-auto-anexos insert publico"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'seguro-auto-anexos');
