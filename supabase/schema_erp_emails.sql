-- ERP O2 — e-mails das caixas O2 ligados a imobiliárias/apólices (27/10/2026). SÓ LEITURA do Gmail:
-- guarda cabeçalho + trecho (300 caracteres), nunca corpo nem anexo. Já aplicado no Supabase (migrations erp_emails
-- e erp_emails_progresso); este arquivo apenas documenta.

create table if not exists erp_emails (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,            -- cabeçalho Message-ID (ou gmail:<caixa>:<id> se faltar)
  thread_id text,
  caixas text[] not null default '{}',        -- caixas O2 em que a mensagem aparece
  data timestamptz,
  de text, para text, cc text, assunto text, trecho text,
  tem_anexo boolean not null default false,
  imobiliaria_id uuid,                        -- ficha única em `imobiliarias`
  imobiliarias_candidatas uuid[] not null default '{}', -- fichas cujo e-mail aparece na mensagem (fichas gêmeas PJ/PF dividem e-mails): a ficha mostra `imobiliaria_id = X ou X = any(candidatas)`
  documento_id uuid,                          -- erp_documentos, quando o nº da apólice aparece no assunto/trecho
  ligacao text[] not null default '{}',       -- como foi ligado: email_imobiliaria, numero_apolice, ambigua_email_compartilhado
  criado_em timestamptz not null default now()
);
create index if not exists erp_emails_imob_idx on erp_emails (imobiliaria_id, data desc) where imobiliaria_id is not null;
create index if not exists erp_emails_doc_idx on erp_emails (documento_id, data desc) where documento_id is not null;
create index if not exists erp_emails_candidatas_idx on erp_emails using gin (imobiliarias_candidatas);
create index if not exists erp_emails_data_idx on erp_emails (data desc);
alter table erp_emails enable row level security;
create policy erp_emails_colab on erp_emails for all
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));

-- Progresso retomável da indexação: uma linha por (caixa, lote de e-mails de imobiliárias, janela em dias).
create table if not exists erp_emails_progresso (
  caixa text not null,
  lote text not null,                         -- hash dos e-mails do lote + janela
  dias int not null,
  lidos int not null default 0,
  truncado boolean not null default false,    -- a busca bateu no limite por busca (há mais e-mails que os gravados)
  concluido_em timestamptz not null default now(),
  primary key (caixa, lote)
);
alter table erp_emails_progresso enable row level security;
create policy erp_emails_progresso_colab on erp_emails_progresso for all
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));

-- Prova de emissão por e-mail (27/10/2026): evidência por documento, sem escrever em erp_documentos.
create table if not exists erp_emails_evidencia_emissao (
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  message_id text not null references erp_emails(message_id) on delete cascade,
  criterio text not null,          -- proposta | nome_completo | nome_parcial
  palavra text,                    -- o que o e-mail diz: apólice enviada | endosso emitido | emitida
  numero_citado text,
  criado_em timestamptz not null default now(),
  primary key (documento_id, message_id)
);
create index if not exists erp_emails_evid_msg_idx on erp_emails_evidencia_emissao (message_id);
alter table erp_emails_evidencia_emissao enable row level security;
create policy erp_emails_evid_colab on erp_emails_evidencia_emissao for all
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));

-- Anexos PDF dos e-mails: arquivo uma vez só (hash) no bucket privado 'anexos-documentos', ligado em erp_documento_anexos
-- (já existente). Na tela, o documento aparece pelo Código O2 = nosso_numero.
insert into storage.buckets (id, name, public) values ('anexos-documentos', 'anexos-documentos', false) on conflict (id) do nothing;
alter table erp_documento_anexos drop constraint if exists erp_documento_anexos_tipo_check;
alter table erp_documento_anexos add constraint erp_documento_anexos_tipo_check
  check (tipo in ('apolice','proposta','cotacao','endosso','boleto','certificado','outro'));
alter table erp_documento_anexos
  add column if not exists sha256 text,
  add column if not exists message_id text,
  add column if not exists tamanho integer,
  add column if not exists lido jsonb not null default '{}'::jsonb,
  add column if not exists situacao text not null default 'provavel' check (situacao in ('confirmada','provavel','conferir'));
create unique index if not exists erp_documento_anexos_doc_sha_idx on erp_documento_anexos (documento_id, sha256);
create index if not exists erp_documento_anexos_msg_idx on erp_documento_anexos (message_id) where message_id is not null;
create policy "anexos_documentos_o2" on storage.objects for all to authenticated
  using (bucket_id = 'anexos-documentos' and (select is_colaborador_o2()))
  with check (bucket_id = 'anexos-documentos' and (select is_colaborador_o2()));
