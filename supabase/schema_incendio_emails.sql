-- Verificação de status via e-mail para produção de Incêndio/Ramos
-- Elementares -- e-mails de confirmação (contratação, apólice emitida,
-- cancelamento) que chegam em incendio@o2seguros.com.br são capturados por
-- um gatilho do Google Apps Script (ver
-- integracoes/google-apps-script/incendio-email-trigger.gs), extraídos por
-- IA e cruzados contra a planilha "COTAÇÃO DIÁRIA RE" do mês corrente.

create table if not exists incendio_emails_confirmacao (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  gmail_thread_id text,
  recebido_em timestamptz not null,
  remetente text not null,
  assunto text not null,
  corpo_texto text not null,
  tipo_confirmacao text not null check (
    tipo_confirmacao in ('contratacao_confirmada', 'apolice_emitida', 'cancelamento_confirmado', 'outro', 'nao_identificado')
  ),
  seguradora text,
  cliente_nome text,
  ramo text,
  numero_apolice text,
  valor numeric,
  planilha_encontrada boolean not null default false,
  planilha_aba text,
  planilha_linha integer,
  planilha_status text,
  divergencia boolean not null default false,
  divergencia_motivo text,
  processado_em timestamptz not null default now()
);

create index if not exists idx_incendio_emails_recebido on incendio_emails_confirmacao (recebido_em desc);
create index if not exists idx_incendio_emails_divergencia on incendio_emails_confirmacao (divergencia) where divergencia = true;

alter table incendio_emails_confirmacao enable row level security;

-- Leitura só pra colaboradores O2 (mesmo padrão de sempre); escrita só via
-- service role (rota da API que recebe do Apps Script), sem policy de
-- insert/update pra usuário comum.
create policy "colaboradores O2 leem incendio_emails_confirmacao"
  on incendio_emails_confirmacao for select
  using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
