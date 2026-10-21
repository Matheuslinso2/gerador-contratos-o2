-- Base Única de Imobiliárias — Fase 1 (estrutura).
-- Desenho aprovado pelo Matheus em 2026-10-16:
-- base-unica-imobiliarias/Desenho-Base-Unica-Imobiliarias.pdf (v3).
--
-- O que esta fase NÃO faz (de propósito): não altera nenhuma coluna
-- existente de `imobiliarias` nem o que os painéis/Faturas/Repasses leem.
-- Só ACRESCENTA colunas novas (nulas) e tabelas novas. Os grupos fixos em
-- src/lib/gruposVisuaisImobiliarias.ts continuam valendo para as telas que
-- já os usam; a tabela `imobiliaria_grupos` é só da base única.

-- 1) Grupos -------------------------------------------------------------
create table if not exists imobiliaria_grupos (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,           -- ex.: RAMIRO_SA
  nome text not null,                   -- ex.: Ramiro Sá
  observacao text,
  criado_por_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table imobiliaria_grupos enable row level security;
drop policy if exists "imobiliaria_grupos colaborador o2" on imobiliaria_grupos;
create policy "imobiliaria_grupos colaborador o2" on imobiliaria_grupos
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));

-- 2) Ficha única: colunas NOVAS em `imobiliarias` (todas nulas) -----------
alter table imobiliarias add column if not exists grupo_id uuid references imobiliaria_grupos(id) on delete set null;
-- Dados da consulta pública de CNPJ (Receita), guardados à parte para nunca
-- sobrescrever o que já está no cadastro.
alter table imobiliarias add column if not exists receita_razao_social text;
alter table imobiliarias add column if not exists receita_nome_fantasia text;
alter table imobiliarias add column if not exists receita_situacao text;
alter table imobiliarias add column if not exists receita_consultada_em timestamptz;
-- Revisão uma a uma (Fase 2): pendente até o Matheus revisar a ficha.
alter table imobiliarias add column if not exists revisao_status text not null default 'pendente'
  check (revisao_status in ('pendente', 'revisada'));
alter table imobiliarias add column if not exists revisada_em timestamptz;
alter table imobiliarias add column if not exists revisada_por_email text;
create index if not exists imobiliarias_grupo_id_idx on imobiliarias(grupo_id);

-- 3/4) Registros de fonte + dicionário de nomes ---------------------------
-- Cada fonte vira um registro guardado como veio. `chave_externa` é a
-- identidade estável dentro da fonte: ID da Empresa no Bitrix, código Corp,
-- CNPJ (Receita / imobiliárias conhecidas), endereço de e-mail, ou o texto
-- exato escrito na planilha / campo livre.
create table if not exists imobiliaria_registros_fonte (
  id uuid primary key default gen_random_uuid(),
  fonte text not null check (fonte in (
    'bitrix_empresa',        -- Empresa (companyId) usada em Fiança/RE
    'bitrix_cap_texto',      -- campo texto "Imob/Admin" da Capitalização
    'corp_produtor',         -- planilha Produtores exportada do Corp
    'receita_cnpj',          -- consulta pública de CNPJ
    'imobiliarias_conhecidas',
    'planilha_fianca',       -- coluna IMOBILIÁRIA das planilhas de análises
    'planilha_re',           -- coluna IMOBILIÁRIA da cotação diária RE
    'planilha_cap',          -- coluna IMOBILIÁRIA das planilhas de títulos de Capitalização (21/10/2026)
    'email'                  -- remetente/destinatário no e-mail do Matheus
  )),
  chave_externa text not null,
  nome_original text,
  dados jsonb not null default '{}'::jsonb,   -- e-mail, telefone, endereço etc. como vieram
  volume integer not null default 0,          -- aparições/itens na fonte (ordenar revisão)
  anos integer[] not null default '{}',
  imobiliaria_id uuid references imobiliarias(id) on delete set null,
  situacao text not null default 'a_identificar' check (situacao in (
    'a_identificar', 'sugerido', 'confirmado', 'rejeitado', 'ignorar'
  )),
  -- Como o vínculo foi feito: cnpj | codigo_corp | email_exato | manual,
  -- ou, para sugestões, nome_exato | nome_parecido.
  metodo_vinculo text,
  sugestoes jsonb not null default '[]'::jsonb, -- [{imobiliaria_id, motivo, score}]
  confirmado_por_email text,
  confirmado_em timestamptz,
  lido_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fonte, chave_externa)
);
create index if not exists imob_registros_fonte_imob_idx on imobiliaria_registros_fonte(imobiliaria_id);
create index if not exists imob_registros_fonte_situacao_idx on imobiliaria_registros_fonte(situacao);

alter table imobiliaria_registros_fonte enable row level security;
drop policy if exists "imob_registros_fonte colaborador o2" on imobiliaria_registros_fonte;
create policy "imob_registros_fonte colaborador o2" on imobiliaria_registros_fonte
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));

-- 7) Cofre de locatários --------------------------------------------------
-- SÓ ARMAZENAMENTO (decisão do Matheus, 2026-10-16): CPF, nome, e-mail e
-- telefone de todo locatário, do histórico e dos que forem entrando.
-- Trancado: RLS ligado e NENHUMA policy — nenhum login (colaborador O2,
-- imobiliária, anon) lê ou escreve; só processos com service_role gravam.
-- Exceção deliberada à regra "toda tabela nova dá ALL pra
-- is_colaborador_o2()". Liberar consulta exige decisão explícita do Matheus.
create table if not exists locatarios (
  id uuid primary key default gen_random_uuid(),
  cpf text not null unique,              -- só dígitos (CPF ou CNPJ do locatário PJ)
  nome text,
  email text,
  telefone text,
  contatos_anteriores jsonb not null default '[]'::jsonb, -- [{campo, valor, ate}] quando muda
  primeira_fonte text,                   -- ex.: planilha_fianca:<arquivoId>
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table locatarios enable row level security;
revoke all on table locatarios from anon, authenticated;

-- Controle da leitura de e-mail (fonte `email`): um dia fechado por vez,
-- só dentro dos últimos 30 dias (limite pedido pelo Matheus). Ver
-- src/app/api/cron/base-unica-emails/route.ts.
create table if not exists base_unica_emails_dias (
  dia date primary key,
  mensagens integer not null default 0,
  enderecos integer not null default 0,
  processado_em timestamptz not null default now()
);
alter table base_unica_emails_dias enable row level security;
drop policy if exists "base_unica_emails_dias colaborador o2" on base_unica_emails_dias;
create policy "base_unica_emails_dias colaborador o2" on base_unica_emails_dias
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));

-- Planilhas de controle congeladas como referência (Matheus, 2026-10-18:
-- "considere como a planilha está nesse momento"). Mês fecha no último dia;
-- alteração posterior num mês fechado = edição indevida (alerta, nunca
-- reimportação silenciosa). Ver scripts/base-unica/congelar-planilhas.mjs.
create table if not exists base_unica_planilhas_congeladas (
  arquivo_id text primary key,
  nome text not null,
  pasta text,
  mime_type text not null,
  modificado_em timestamptz,
  revisao_id text,
  md5 text,
  tamanho_bytes bigint,
  congelado_em timestamptz not null default now(),
  verificado_em timestamptz,
  alterado_depois boolean not null default false,
  alterado_em timestamptz
);
alter table base_unica_planilhas_congeladas enable row level security;
drop policy if exists "planilhas_congeladas colaborador o2" on base_unica_planilhas_congeladas;
create policy "planilhas_congeladas colaborador o2" on base_unica_planilhas_congeladas
  for all to authenticated
  using ((select public.is_colaborador_o2()))
  with check ((select public.is_colaborador_o2()));

-- Cópia física das planilhas congeladas (2026-10-18): bucket PRIVADO, sem
-- nenhuma policy em storage.objects — só service_role lê/grava (as planilhas
-- têm CPF de locatário, mesmo tratamento do cofre). Limite 50 MB por arquivo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('planilhas-congeladas', 'planilhas-congeladas', false, 52428800)
on conflict (id) do nothing;

alter table base_unica_planilhas_congeladas add column if not exists copia_storage_path text;
alter table base_unica_planilhas_congeladas add column if not exists copia_tamanho_bytes bigint;
alter table base_unica_planilhas_congeladas add column if not exists copia_md5 text;
alter table base_unica_planilhas_congeladas add column if not exists copiado_em timestamptz;

-- Atualização 2026-10-21: planilhas de títulos de Capitalização (jul/2021 →
-- jul/2026) entram na produção unificada; o nome da imobiliária vira registro
-- da fonte 'planilha_cap' (scripts/base-unica/importar-planilhas-cap.ts).
alter table imobiliaria_registros_fonte drop constraint if exists imobiliaria_registros_fonte_fonte_check;
alter table imobiliaria_registros_fonte add constraint imobiliaria_registros_fonte_fonte_check check (fonte in (
  'bitrix_empresa', 'bitrix_cap_texto', 'corp_produtor', 'receita_cnpj', 'imobiliarias_conhecidas',
  'planilha_fianca', 'planilha_re', 'planilha_cap', 'email'
));
