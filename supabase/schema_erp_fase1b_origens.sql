-- ERP O2 — Fase 1b / etapa T2: origem do documento no CRM (Bitrix)
-- Princípio do Matheus (25/10/2026): o card do Bitrix é o INÍCIO da informação. Tudo que
-- o card tem acompanha o documento até virar apólice: pré-cadastro para revisão humana
-- (ou criação automática quando o fluxo for 100% confiável), campos preenchidos sempre que
-- a informação é pertinente (endereço, locatário, aluguel, coberturas, plano, vigência),
-- e a trilha inteira do card (etapas, comentários) salva e vinculada ao documento.

create table if not exists erp_origens (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  sistema text not null default 'bitrix',
  entity_type_id int,                 -- 1042 Fiança · 1048 Cap · 1046 RE
  item_id bigint not null,            -- id do card
  categoria_id int,
  etapa_id text,
  titulo text,
  url text,
  dados jsonb not null default '{}'::jsonb,            -- card inteiro (todos os campos, com os rótulos resolvidos em dados_legiveis)
  dados_legiveis jsonb not null default '{}'::jsonb,   -- {rótulo: valor} só dos campos preenchidos
  historico_etapas jsonb not null default '[]'::jsonb, -- [{quando, categoria, etapa, semantica}]
  comentarios jsonb not null default '[]'::jsonb,      -- [{quando, autor, texto}]
  comentarios_capturados_em timestamptz,
  card_criado_em timestamptz,
  card_atualizado_em timestamptz,
  capturado_em timestamptz not null default now(),
  unique (sistema, entity_type_id, item_id)
);
create index if not exists erp_origens_doc_idx on erp_origens(documento_id);
alter table erp_origens enable row level security;
drop policy if exists erp_origens_o2 on erp_origens;
create policy erp_origens_o2 on erp_origens for all to authenticated
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));

-- Pré-cadastro: o documento nasce 'cotacao' com revisao_pendente = true; alguém da equipe
-- confirma na tela (revisado_por/em). Enquanto a confiança no fluxo não for total, nada
-- vira apólice sem revisão humana.
alter table erp_documentos
  add column if not exists revisao_pendente boolean not null default false,
  add column if not exists revisado_por_email text,
  add column if not exists revisado_em timestamptz;

-- origem 'bitrix' já existia no check; garante
alter table erp_documentos drop constraint if exists erp_documentos_origem_check;
alter table erp_documentos add constraint erp_documentos_origem_check
  check (origem in ('corp_import','bitrix','manual','api'));

-- Vocabulário do funil: cotação recusada pela seguradora = 'recusado'; proposta perdida na
-- negociação = 'perdido'. 'cancelado' fica só para apólice cancelada.
alter table erp_documentos drop constraint if exists erp_documentos_situacao_check;
alter table erp_documentos add constraint erp_documentos_situacao_check check (situacao in
  ('cotacao','proposta','recusado','perdido','digitado','emitido','vigente','vencido','cancelado','devolvido'));
