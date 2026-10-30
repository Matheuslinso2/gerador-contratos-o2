-- Cards do funil Campanhas (Bitrix) ligados à campanha do Workspace (30/10/2026).
-- Cada card é UMA imobiliária dentro de UMA campanha. Esta tabela só guarda a
-- ligação campanha + imobiliária (base única) + card do Bitrix; não é cadastro
-- de imobiliária. O panorama (versões) entra em tabela própria na Etapa 2.
--
-- origem 'vinculado' = card que já existia no Bitrix e foi só ligado à campanha;
-- origem 'criado'    = card criado pelo Workspace ao enviar os e-mails iniciais.
--
-- Tabela PRIVADA: RLS ligada e sem política; só o servidor (service role) lê e
-- grava (a aba do card roda no iframe do Bitrix, sem sessão do Workspace).

alter table public.campanhas add column if not exists criar_cards_bitrix boolean not null default false;
alter table public.campanhas add column if not exists cards_bitrix_ativado_por text;
alter table public.campanhas add column if not exists cards_bitrix_ativado_em timestamptz;

create table if not exists public.campanhas_cards_bitrix (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas(id) on delete cascade,
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,
  bitrix_deal_id bigint not null,
  bitrix_company_id bigint,
  origem text not null check (origem in ('vinculado', 'criado')),
  titulo text,
  criado_por text,
  created_at timestamptz not null default now(),
  unique (campanha_id, imobiliaria_id),
  unique (bitrix_deal_id)
);
create index if not exists campanhas_cards_bitrix_campanha on public.campanhas_cards_bitrix (campanha_id);
alter table public.campanhas_cards_bitrix enable row level security;

-- Etapa 3 (30/10/2026): acompanhamento da equipe na aba "Panorama da campanha" do card.
alter table public.campanhas_cards_bitrix add column if not exists proxima_acao text;
alter table public.campanhas_cards_bitrix add column if not exists observacao text;
alter table public.campanhas_cards_bitrix add column if not exists atualizado_por text;
alter table public.campanhas_cards_bitrix add column if not exists atualizado_em timestamptz;
