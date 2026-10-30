-- Revisão de segurança 30/10/2026 — fase E (anexos)
-- (docs/PLANO-SEGURANCA-PROXIMOS-PASSOS-2026-10-30.md)

-- 1) JÁ APLICADO em 30/10: limite de tamanho e tipos nos buckets dos
--    formulários públicos. Sai .doc (Word antigo) e .xls (Excel antigo),
--    que podem carregar macro; .docx/.xlsx não rodam macro.
update storage.buckets set file_size_limit = 26214400,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
 where id = 'seguro-auto-anexos';
update storage.buckets set file_size_limit = 26214400,
  allowed_mime_types = array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/vnd.oasis.opendocument.spreadsheet','application/pdf']
 where id = 'seguro-incendio-anexos';
update storage.buckets set file_size_limit = 26214400 where id in ('seguro-celular-anexos','condominio-anexos');
update storage.buckets set file_size_limit = 52428800 where id = 'auditoria-temp';

-- 2) APLICAR SÓ DEPOIS de publicar o commit que faz o servidor baixar o
--    arquivo do Auditor público com service_role (auditar-contrato/actions.ts).
--    Antes disso, qualquer visitante podia listar, baixar e apagar os
--    contratos enviados por outros visitantes em auditoria-temp/publico/.
--    O visitante continua podendo só ENVIAR para essa pasta.
drop policy if exists "auditoria-temp select publico" on storage.objects;
drop policy if exists "auditoria-temp delete publico" on storage.objects;
