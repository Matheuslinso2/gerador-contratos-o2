-- Panorama de Preços do Seguro Fiança (15/10/2026) -- cada linha é uma
-- VERSÃO do panorama de um card do Bitrix (SPA 1042). Versões nunca são
-- sobrescritas: nova negociação/atualização de status = versão N+1.
-- Spec: seguro-fianca-analise/ESPECIFICACAO-PANORAMA-PRECOS-FIANCA.md
-- Fase 1 só gera PNG/PDF; colunas de envio entram na Fase 2.

create table if not exists public.panoramas_fianca (
  id uuid primary key default gen_random_uuid(),
  card_id integer not null,             -- id do card na SPA Seguro Fiança
  versao integer not null,
  cabecalho jsonb not null,             -- retrato do card no momento (imobiliária, inquilino, imóvel, valores)
  linhas jsonb not null,                -- seguradoras/planos com status e grade de preços (plano × LMI → parcelas + valor)
  forma_pagamento text not null check (forma_pagamento in ('fatura', 'boleto', 'cartao')),
  assinatura_status text not null,      -- status das seguradoras no momento -- se mudar no Bitrix, card volta pra fila como "Atualização disponível"
  gerado_por_email text not null,
  gerado_em timestamptz not null default now(),
  unique (card_id, versao)
);

create index if not exists panoramas_fianca_card_idx on public.panoramas_fianca (card_id, versao desc);

alter table public.panoramas_fianca enable row level security;

drop policy if exists "colaborador_o2_all" on public.panoramas_fianca;
create policy "colaborador_o2_all" on public.panoramas_fianca
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));
