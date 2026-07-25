-- Fase 5: permitir upload de logos (sem login ainda, então liberado geral por enquanto)
create policy "logos upload e leitura livres"
on storage.objects
for all
using (bucket_id = 'logos')
with check (bucket_id = 'logos');
