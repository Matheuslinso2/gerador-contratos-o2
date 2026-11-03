-- Ofertas de seguradora por cotação de Fiança (Matheus, 03/11/2026): perdidas e
-- recusadas também geram dado estatístico. O card do Bitrix guarda, para cada
-- seguradora cotada, valor da parcela, nº de parcelas, % do aluguel/locação,
-- comissão e status — mesmo quando a cotação NÃO fecha. Antes só a escolhida
-- ia para producao_unificada (seguradora/premio). Filha de producao_unificada
-- (1 linha por cotação × seguradora); não é cadastro de imobiliária — o vínculo
-- com a imobiliária continua pela linha-mãe (banco único).
-- Acesso: só colaborador O2 (is_colaborador_o2); anon e imobiliárias não leem.
create table if not exists producao_cotacao_ofertas (
  id uuid primary key default gen_random_uuid(),
  producao_id uuid not null references producao_unificada(id) on delete cascade,
  origem_bitrix_id text not null,
  seguradora text not null,
  status jsonb not null default '{}'::jsonb,
  valor_parcela numeric,
  parcelas numeric, -- há cards com valor decimal (digitado errado): guardado como veio
  premio_total_cotado numeric,
  comissao_pct numeric,
  pct_aluguel numeric,
  pct_locacao numeric,
  escolhida boolean not null default false,
  atualizado_em timestamptz not null default now(),
  unique (producao_id, seguradora)
);
create index if not exists producao_cotacao_ofertas_origem_idx on producao_cotacao_ofertas (origem_bitrix_id);
alter table producao_cotacao_ofertas enable row level security;
drop policy if exists ofertas_colaborador_o2 on producao_cotacao_ofertas;
create policy ofertas_colaborador_o2 on producao_cotacao_ofertas for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
