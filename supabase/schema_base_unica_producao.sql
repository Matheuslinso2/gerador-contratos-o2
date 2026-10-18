-- Base Única — Fase 3: linha do tempo de produção.
-- Duas camadas (decisão do Matheus, 2026-10-18), para TODOS os produtos:
--   * FUNIL (cotação/negociação): planilhas (antes) e CRM/Bitrix (hoje);
--   * PRODUÇÃO REAL (efetivada): Corp.
-- Cada linha de planilha vira uma linha (inclusive a cópia herdada do mês
-- anterior, ligada pela chave_caso); cada proposta do Corp vira uma linha
-- (chave produto + nº). A imobiliária NÃO é gravada: a view producao_resolvida
-- resolve pelo dicionário imobiliaria_registros_fonte (só vínculo confirmado).
-- Dados pessoais do locatário só no cofre `locatarios` (aqui só locatario_id).
-- Importadores: scripts/base-unica/importar-planilhas.mjs e importar-corp-propostas.mjs.

create table if not exists base_unica_importacoes (
  id uuid primary key default gen_random_uuid(),
  arquivo_id text not null references base_unica_planilhas_congeladas(arquivo_id),
  arquivo_nome text not null,
  aba text not null,
  produto text not null,
  layout text not null,
  competencia text,
  linhas_lidas integer not null default 0,
  linhas_importadas integer not null default 0,
  descartes jsonb not null default '{}'::jsonb,
  totais_planilha jsonb not null default '{}'::jsonb,
  totais_importados jsonb not null default '{}'::jsonb,
  confere boolean,
  observacao text,
  importado_em timestamptz not null default now(),
  unique (arquivo_id, aba)
);

create table if not exists producao_unificada (
  id uuid primary key default gen_random_uuid(),
  produto text not null check (produto in ('fianca', 're', 'automovel', 'capitalizacao')),
  tipo text not null check (tipo in ('novo', 'renovacao', 'endosso', 'sinistro', 'cancelamento', 'emissao')),
  fonte text not null default 'planilha' check (fonte in ('planilha', 'bitrix', 'corp')),
  importacao_id uuid references base_unica_importacoes(id) on delete cascade,
  origem_arquivo_id text,
  origem_aba text,
  origem_linha integer,
  origem_bitrix_id text,
  origem_corp_numero text,
  competencia_arquivo text,
  herdada boolean not null default false,
  chave_caso text,
  data_recebimento date,
  data_efetivacao date,
  status_original text,
  status_padrao text,
  ramo_original text,
  ramo_padrao text,
  seguradora text,
  plano text,
  imobiliaria_texto text,
  fonte_vinculo text,
  responsavel text,
  aluguel numeric(14,2),
  premio numeric(14,2),
  comissao numeric(14,2),
  locatario_id uuid references locatarios(id),
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (origem_arquivo_id, origem_aba, origem_linha)
);
create index if not exists producao_unificada_caso_idx on producao_unificada(chave_caso);
create index if not exists producao_unificada_imob_idx on producao_unificada(fonte_vinculo, imobiliaria_texto);
create index if not exists producao_unificada_comp_idx on producao_unificada(produto, competencia_arquivo);
create unique index if not exists producao_unificada_corp_numero_uidx
  on producao_unificada (produto, origem_corp_numero) where fonte = 'corp';

create table if not exists base_unica_traducao_status (
  produto text not null,
  tipo text not null,
  valor_original text not null,
  status_padrao text,
  regra_origem text,
  ocorrencias integer not null default 0,
  validado boolean not null default false,
  validado_por_email text,
  validado_em timestamptz,
  primary key (produto, tipo, valor_original)
);
create table if not exists base_unica_traducao_ramo (
  valor_original text primary key,
  produto text,
  ramo_padrao text,
  regra_origem text,
  ocorrencias integer not null default 0,
  validado boolean not null default false,
  validado_por_email text,
  validado_em timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['base_unica_importacoes','producao_unificada','base_unica_traducao_status','base_unica_traducao_ramo'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "%s colaborador o2" on %I', t, t);
    execute format('create policy "%s colaborador o2" on %I for all to authenticated using ((select public.is_colaborador_o2())) with check ((select public.is_colaborador_o2()))', t, t);
  end loop;
end $$;

create or replace view producao_resolvida with (security_invoker = true) as
select p.*,
       v.imobiliaria_id,
       i.grupo_id,
       coalesce(g.nome, i.apelido, i.nome) as imobiliaria_exibicao
from producao_unificada p
left join lateral (
  select r.imobiliaria_id
  from imobiliaria_registros_fonte r
  where r.fonte = p.fonte_vinculo
    and r.situacao = 'confirmado'
    and (r.chave_externa = p.imobiliaria_texto or r.nome_original = p.imobiliaria_texto)
  order by (r.chave_externa = p.imobiliaria_texto) desc
  limit 1
) v on true
left join imobiliarias i on i.id = v.imobiliaria_id
left join imobiliaria_grupos g on g.id = i.grupo_id;

create index if not exists imob_registros_fonte_nome_idx on imobiliaria_registros_fonte (fonte, nome_original) where situacao = 'confirmado';
