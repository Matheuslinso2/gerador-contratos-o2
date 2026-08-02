-- Políticas de acesso dos buckets de Faturas (esqueci de incluir junto do
-- schema_faturas.sql). Buckets precisam já existir (criados manualmente no
-- painel, "Public" desligado): faturas-temp e faturas.

-- faturas-temp: upload direto do navegador, path prefixado por auth.uid()
-- (mesmo padrão do bucket auditoria-temp já usado no Auditor de Contrato).
drop policy if exists "faturas-temp select proprio" on storage.objects;
create policy "faturas-temp select proprio"
on storage.objects for select
to authenticated
using (bucket_id = 'faturas-temp' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "faturas-temp insert proprio" on storage.objects;
create policy "faturas-temp insert proprio"
on storage.objects for insert
to authenticated
with check (bucket_id = 'faturas-temp' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "faturas-temp delete proprio" on storage.objects;
create policy "faturas-temp delete proprio"
on storage.objects for delete
to authenticated
using (bucket_id = 'faturas-temp' and (storage.foldername(name))[1] = auth.uid()::text);

-- faturas (definitivo): path é por competência, não por usuário — qualquer
-- colaborador O2 precisa ler/gravar (mesmo domínio das tabelas faturas_*).
drop policy if exists "faturas select o2" on storage.objects;
create policy "faturas select o2"
on storage.objects for select
to authenticated
using (bucket_id = 'faturas' and auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "faturas insert o2" on storage.objects;
create policy "faturas insert o2"
on storage.objects for insert
to authenticated
with check (bucket_id = 'faturas' and auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "faturas delete o2" on storage.objects;
create policy "faturas delete o2"
on storage.objects for delete
to authenticated
using (bucket_id = 'faturas' and auth.jwt() ->> 'email' like '%@o2seguros.com.br');
