-- Fase 4 do e-mail no card: anexos. Bucket PRIVADO (sem política pública) --
-- escrita só acontece via signed upload URL (gerado com service role,
-- expira sozinho), leitura só via service role no servidor na hora de
-- montar o e-mail. Nenhum RLS público necessário.
insert into storage.buckets (id, name, public, file_size_limit)
values ('bitrix-email-anexos', 'bitrix-email-anexos', false, 15728640) -- 15 MB por arquivo
on conflict (id) do nothing;
