-- Base de legislação (02/11/2026) para consulta pelo Robô O2 do chat e pelo ERP. Carga: scripts/erp/carregar-legislacao.ts (a partir de erp-o2/conhecimento-legislacao).
-- Fonte: textos oficiais do Planalto, do Sistema de Legislação da SUSEP e do STJ. Não é parecer jurídico.
create table if not exists public.legislacao_normas (
  id uuid primary key default gen_random_uuid(), pasta text not null, tipo text, numero text, ano integer, titulo text not null, ementa text, url text, situacao text,
  temas text, arquivo text not null unique, coletado_em date, observacoes text, tamanho_texto integer, criado_em timestamptz not null default now());
create table if not exists public.legislacao_trechos (
  id bigserial primary key, norma_id uuid not null references public.legislacao_normas(id) on delete cascade, ordem integer not null, rotulo text, artigo text,
  texto text not null, texto_busca text not null, tsv tsvector generated always as (to_tsvector('portuguese', texto_busca)) stored, unique (norma_id, ordem));
create index if not exists legislacao_trechos_tsv_idx on public.legislacao_trechos using gin (tsv);
create index if not exists legislacao_trechos_artigo_idx on public.legislacao_trechos (norma_id, artigo);
-- RLS: colaborador O2 (ALL), como as demais tabelas do ERP. Função legislacao_buscar(consulta, normas, limite): busca por relevância (português, sem acento).
