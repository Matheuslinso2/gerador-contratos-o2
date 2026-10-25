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

-- 25/10 (noite): imóvel ADMINISTRADO × NÃO ADMINISTRADO (Matheus): administrado = a imobiliária cuida
-- da locação na vigência (taxa de administração mensal, cobra e é o contato); não administrado = só
-- apresentou as partes (comissão única), o proprietário cuida. Vem do card de Fiança
-- ("Imóvel será administrado?" / ADMINISTRADO?) e muda cobrança (fatura × individual) e contato na renovação.
alter table erp_documento_itens add column if not exists administrado boolean;
-- Matheus 25/10: administrado vale para Fiança, Capitalização e Incêndio (não Automóvel). A forma de
-- cobrança denuncia: imob com fatura aberta no produto contrata por fatura (melhor condição); se foi por
-- boleto individual, provavelmente a locação NÃO é administrada. Inferência com origem marcada.
alter table erp_documento_itens add column if not exists administrado_fonte text
  check (administrado_fonte in ('card','inferido_fatura','manual'));
create or replace function erp_inferir_administrado() returns table (marcados_sim int, marcados_nao int)
language plpgsql security definer set search_path = public as $$
declare v_s int; v_n int;
begin
  update erp_documento_itens it set administrado = true, administrado_fonte = 'inferido_fatura'
  from erp_alertas_fatura_pronto a
  where a.documento_id = it.documento_id and it.item_n = 1 and it.administrado is null and a.alerta = 'ok';
  get diagnostics v_s = row_count;
  update erp_documento_itens it set administrado = false, administrado_fonte = 'inferido_fatura'
  from erp_alertas_fatura_pronto a
  where a.documento_id = it.documento_id and it.item_n = 1 and it.administrado is null and a.alerta = 'fora_da_fatura';
  get diagnostics v_n = row_count;
  return query select v_s, v_n;
end $$;
revoke all on function erp_inferir_administrado() from public;
grant execute on function erp_inferir_administrado() to service_role;
-- chamada 1×/h depois de erp_atualizar_alertas_fatura (cron erp-bitrix spa=1042)
