-- Acervo de apólices em PDF (23/10/2026, pedido do Matheus): as apólices de
-- Seguro Fiança salvas no Drive (pasta IMOBILIARIAS, 2019–2025) são lidas e
-- ligadas à apólice do Corp, para trazer o que o Corp não tem -- inquilinos
-- (garantidos), local de risco, coberturas/LMI e a imobiliária estipulante --
-- e ligar sinistros e demais módulos a essas pessoas.
--
-- Regra de ouro: só entra dado 100% certo. Uma apólice só ganha nosso_numero
-- (situacao 'certa') quando o casamento com o Corp confere TRÊS coisas:
--   regra 'numero_vigencia'   -- nº do Corp contido no nº do PDF (≥ 6 dígitos),
--                                fim de vigência igual (±1 dia), só emissão
--                                (NOVO/RENV sem endosso) do espelho corp_grade;
--   regra 'segurado_vigencia' -- (apólices de antes de 2020, fora do espelho)
--                                CPF/CNPJ do segurado + seguradora + início e
--                                fim exatos no relatório antigo do Corp;
--   e, nas duas, o CPF/CNPJ do segurado do PDF = cliente do Corp no cofre.
-- O resto fica 'conferir' / 'sem_par' / 'outro_ramo' / 'nao_lida', sem ligação.
--
-- Dados pessoais (nome, CPF, contato) SÓ no cofre `locatarios`; aqui ficam
-- apenas os vínculos (apolice_partes.locatario_id). Imobiliária: continua
-- vindo do Corp pelo código do produtor; o CNPJ da estipulante é guardado e
-- vira sugestão de vínculo no banco único (nunca ficha nova).
-- Carga: scripts/apolices/carga-drive.ts (listar → ler → casar → gravar).
-- Aplicado via MCP.

create table if not exists apolice_documentos (
  id uuid primary key default gen_random_uuid(),
  fonte text not null default 'drive' check (fonte in ('drive', 'sinistro', 'upload')),
  arquivo_id text not null unique,          -- id do arquivo no Drive
  arquivo_nome text,
  arquivo_pasta_id text,
  arquivo_criado_em timestamptz,
  produto text not null default 'fianca',
  seguradora text,                          -- código do Corp: PORT, POTT, TOO, TOKI, YELU, BRAD...
  numero_apolice text,                      -- como está no PDF
  ramo text,                                -- ramo SUSEP lido (0746 = Fiança)
  vigencia_inicio date,
  vigencia_fim date,
  emitida_em date,
  limite_maximo_garantia numeric(14,2),
  coberturas jsonb not null default '[]'::jsonb,   -- [{cobertura, verba, lmi}]
  local_risco jsonb not null default '{}'::jsonb,  -- {texto, cep, cidade, uf}
  estipulante_nome text,
  estipulante_documento text,               -- CNPJ/CPF da imobiliária estipulante
  nosso_numero text,                        -- apólice no Corp; só quando situacao = 'certa'
  regra_casamento text check (regra_casamento in ('numero_vigencia', 'segurado_vigencia')),
  situacao text not null check (situacao in ('certa', 'conferir', 'sem_par', 'outro_ramo', 'nao_lida')),
  motivo text,
  lido_em timestamptz not null default now(),
  gravado_em timestamptz not null default now(),
  check (situacao <> 'certa' or nosso_numero is not null)
);
create index if not exists apolice_documentos_nn_idx on apolice_documentos (nosso_numero) where nosso_numero is not null;
create index if not exists apolice_documentos_situacao_idx on apolice_documentos (situacao);

create table if not exists apolice_partes (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references apolice_documentos(id) on delete cascade,
  nosso_numero text,                        -- repetido do documento (busca direta)
  papel text not null check (papel in ('segurado', 'garantido')),
  ordem smallint not null default 1,        -- 1º, 2º, 3º locatário...
  locatario_id uuid not null references locatarios(id),
  unique (documento_id, papel, ordem)
);
create index if not exists apolice_partes_nn_idx on apolice_partes (nosso_numero) where nosso_numero is not null;

-- 23/10/2026 (pedido do Matheus): qualquer ramo, apólices com vigência desde 2020.
-- Casamento sem depender do modelo do PDF: o texto tem que trazer o nº da apólice
-- do Corp (emissão desde 2020), o fim da vigência (±1 dia) e o CPF/CNPJ do cliente
-- do Corp -- regra 'numero_vigencia_cliente'. Locatários/coberturas lidos pelas
-- regras fixas só na Fiança, e só quando o segurado lido = cliente do Corp.
alter table apolice_documentos drop constraint if exists apolice_documentos_regra_casamento_check;
alter table apolice_documentos add constraint apolice_documentos_regra_casamento_check
  check (regra_casamento in ('numero_vigencia', 'segurado_vigencia', 'numero_vigencia_cliente'));
alter table apolice_documentos alter column produto drop default;
create index if not exists apolice_partes_locatario_idx on apolice_partes (locatario_id);

-- 23/10/2026: PDFs anexados na caixa do Matheus também entram (fonte 'email',
-- arquivo_id "gmail:<mensagem>:<parte>", arquivo_pasta_id = conversa).
alter table apolice_documentos drop constraint if exists apolice_documentos_fonte_check;
alter table apolice_documentos add constraint apolice_documentos_fonte_check
  check (fonte in ('drive', 'email', 'sinistro', 'upload'));

-- Só equipe O2 (regra: tabela nova já nasce com ALL para is_colaborador_o2).
alter table apolice_documentos enable row level security;
alter table apolice_partes enable row level security;
drop policy if exists "apolice_documentos o2" on apolice_documentos;
create policy "apolice_documentos o2" on apolice_documentos for all to authenticated
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));
drop policy if exists "apolice_partes o2" on apolice_partes;
create policy "apolice_partes o2" on apolice_partes for all to authenticated
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));
