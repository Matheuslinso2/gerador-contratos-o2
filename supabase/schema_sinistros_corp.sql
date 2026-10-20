-- Histórico de sinistros (todos os ramos) vindo das exportações do Corp
-- ("Consulta de sinistros" encerrados/pendentes + "Grade"). Base dos KPIs de
-- sinistro (frequência, sinistralidade, desfecho) até o módulo novo
-- (tabela `sinistros`) acumular histórico próprio. Retrato e regras em
-- entregaveis/modulo-sinistro/Historico Sinistros Corp - Retrato Inicial.pdf.
--
-- Carga: scripts/sinistros/importar-corp.mjs (reexecutável -- reconhece o
-- que já existe pela `chave` e atualiza situação/valores).
-- Acesso: só equipe O2 (contém dados de clientes). Aplicado via MCP.

create table if not exists sinistros_corp (
  id uuid primary key default gen_random_uuid(),
  -- Nosso Nº | nº do sinistro (sem o "F" final) | ocorrência | item
  chave text not null unique,
  nosso_numero text not null,            -- = producao_unificada.origem_corp_numero (apólice)
  numero_sinistro text,
  situacao text not null check (situacao in ('INDENIZADO', 'ENCERRADO SEM INDENIZAÇÃO', 'PENDENTE', 'EM ANDAMENTO')),
  tipo_sinistro text check (tipo_sinistro in ('ocupado', 'chaves')),  -- inferido da descrição; nulo se não der
  seguradora text,
  ramo text,
  apolice text,
  item text,
  segurado text,
  email text,
  dt_ocorrencia date,
  dt_aviso date,
  dt_vistoria date,
  dt_liberacao date,
  dt_encerramento date,
  franquia numeric(14,2),
  vl_avisado numeric(14,2),
  vl_indenizado numeric(14,2),           -- acumulado (o Corp não exporta as parcelas)
  vl_despesas numeric(14,2),
  descricao text,
  observacoes text,
  agendamento text,
  responsavel text,
  ultimo_historico text,
  produtor text,
  produtor_indireto text,
  cobertura text,
  fontes text[] not null default '{}',   -- consulta / grade
  importado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists sinistros_corp_nn_idx on sinistros_corp(nosso_numero);
create index if not exists sinistros_corp_datas_idx on sinistros_corp(dt_aviso, dt_encerramento);

alter table sinistros_corp enable row level security;
drop policy if exists "sinistros_corp o2" on sinistros_corp;
create policy "sinistros_corp o2" on sinistros_corp for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());

-- Fase B (20/10/2026): todos os ramos do Corp. produto = chave do painel
-- (fianca, capitalizacao, automovel, incendio, ...; ver produto_sinistro_de_ramo
-- em schema_sinistros_dashboard.sql); subtipo = motivo do resgate na
-- Capitalização (cap_execucao, cap_acordo, cap_debitos, cap_reaplicacao,
-- cap_administrativo, cap_resgate), tirado da Descrição.
alter table sinistros_corp add column if not exists produto text;
alter table sinistros_corp add column if not exists subtipo text;
update sinistros_corp set produto = 'fianca' where produto is null;
create index if not exists sinistros_corp_produto_idx on sinistros_corp(produto);
