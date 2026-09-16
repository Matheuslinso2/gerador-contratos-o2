-- Auditor de Contrato liberado sem login (pedido do Matheus, 16/09/2026) --
-- ver src/app/auditar-contrato/actions.ts (auditarPublico) e page.tsx.
-- Limite de 5 análises por IP, sem histórico salvo (diferente de
-- auditorias_contrato, que continua exclusiva de contas reais).

-- Só conta uso por IP -- sem policy nenhuma, só o service role
-- (createServiceClient) lê/escreve aqui, nunca o client do navegador.
create table if not exists auditor_publico_uso (
  id bigint generated always as identity primary key,
  ip text not null,
  criado_em timestamptz not null default now()
);
create index if not exists auditor_publico_uso_ip_idx on auditor_publico_uso (ip);
alter table auditor_publico_uso enable row level security;

-- Upload anônimo no MESMO bucket que a análise logada usa
-- (schema_auditoria_upload_bucket.sql), mas restrito ao prefixo "publico/"
-- -- o resto do bucket ({auth.uid()}/...) continua exclusivo de quem tem
-- login de verdade.
create policy "auditoria-temp select publico" on storage.objects for select to anon
using (bucket_id = 'auditoria-temp' and (storage.foldername(name))[1] = 'publico');
create policy "auditoria-temp insert publico" on storage.objects for insert to anon
with check (bucket_id = 'auditoria-temp' and (storage.foldername(name))[1] = 'publico');
create policy "auditoria-temp delete publico" on storage.objects for delete to anon
using (bucket_id = 'auditoria-temp' and (storage.foldername(name))[1] = 'publico');
