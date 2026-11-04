-- Engajamento da imobiliária (03/11/2026): retrato por unidade (ficha ou grupo) numa janela,
-- com duas medidas separadas -- esforço (O2 -> imobiliária) e resposta (imobiliária -> O2).
-- Só metadados (data, canal, direção, duração); nunca o conteúdo das conversas.
-- Tabela PRIVADA (RLS ligada, sem política): só o servidor (service role) lê e grava.

create table if not exists public.imobiliaria_engajamento_snapshot (
  id uuid primary key default gen_random_uuid(),
  unidade text not null,
  imobiliaria_ids uuid[] not null default '{}',
  nome text,
  janela_inicio date not null,
  janela_fim date not null,
  esforco_pontos numeric not null default 0,
  resposta_pontos numeric not null default 0,
  pct_esforco int,
  pct_resposta int,
  nivel_esforco text,
  nivel_resposta text,
  disponibilidade text not null default 'ok' check (disponibilidade in ('ok','sem_empresa_bitrix')),
  sinais jsonb not null default '{}',
  criado_em timestamptz not null default now(),
  unique (unidade, janela_inicio, janela_fim)
);
alter table public.imobiliaria_engajamento_snapshot enable row level security;

-- Carteira ativa (referência dos percentis): fichas com ao menos uma cotação/contratação nova
-- (Fiança ou Capitalização) no período.
create or replace function public.imobiliarias_ativas(p_desde date, p_ate date)
returns table(imobiliaria_id uuid)
language sql stable set search_path to 'public'
as $$
  select distinct r.imobiliaria_id
  from producao_unificada p
  join imobiliaria_registros_fonte r on r.fonte = p.fonte_vinculo and r.situacao = 'confirmado' and r.imobiliaria_id is not null
       and (r.chave_externa = p.imobiliaria_texto or r.nome_original = p.imobiliaria_texto)
  where p.fonte in ('planilha','bitrix') and p.produto in ('fianca','capitalizacao') and p.tipo is distinct from 'renovacao'
    and coalesce(p.data_efetivacao, p.data_recebimento) between p_desde and p_ate;
$$;
