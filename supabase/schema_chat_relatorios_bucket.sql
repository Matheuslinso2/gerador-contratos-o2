-- Relatórios em PDF gerados pelo Robô O2 do chat. Bucket privado, só PDF até 10 MB, sem policy: só o servidor (service role) grava e assina o link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatorios-robo', 'relatorios-robo', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
