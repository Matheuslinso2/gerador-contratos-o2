-- Antes de ir pra produção: travar upload de logo para exigir login
-- (leitura continua pública, só upload/edição/exclusão exige autenticação)

drop policy if exists "logos upload e leitura livres" on storage.objects;

create policy "logos leitura publica"
on storage.objects for select
using (bucket_id = 'logos');

create policy "logos upload autenticado"
on storage.objects for insert
to authenticated
with check (bucket_id = 'logos');

create policy "logos update autenticado"
on storage.objects for update
to authenticated
using (bucket_id = 'logos')
with check (bucket_id = 'logos');

create policy "logos delete autenticado"
on storage.objects for delete
to authenticated
using (bucket_id = 'logos');
