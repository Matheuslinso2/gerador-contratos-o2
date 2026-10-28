-- Painel Comercial v5 (28/10/2026). Tabelas PRIVADAS: só o servidor (service role)
-- lê e escreve. RLS ligada e SEM política de propósito: os retratos contêm
-- comissão individual (remuneração) e o filtro por perfil é feito na API.

-- Retrato dos datasets calculados do Bitrix (uma linha só). A API lê daqui e
-- filtra por perfil; recalcula quando o retrato passa de 10 minutos.
create table if not exists public.painel_comercial_snapshot (
  id int primary key default 1 check (id = 1),
  gerado_em timestamptz not null default now(),
  dados jsonb not null
);
alter table public.painel_comercial_snapshot enable row level security;

-- Mês encerrado vira retrato fixo (regra "mês fechado congela"). Setembro/26 vem
-- do export de 15/10 (preenchimento antigo do CRM), entregue no pacote.
create table if not exists public.painel_comercial_meses_fechados (
  mes text primary key,
  kpi jsonb not null default '[]'::jsonb,
  origem text,
  congelado_em timestamptz not null default now()
);
alter table public.painel_comercial_meses_fechados enable row level security;

-- Meta personalizada por cliente nas Campanhas. Fica no Workspace, nunca no
-- Bitrix. Sem valor aqui = "meta não definida" na tela (nada é inventado).
create table if not exists public.painel_comercial_metas_campanha (
  card bigint primary key,
  meta numeric,
  unidade text,
  prazo date,
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);
alter table public.painel_comercial_metas_campanha enable row level security;
