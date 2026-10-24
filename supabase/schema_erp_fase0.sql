-- ERP próprio da O2 — Fase 0 (Fundação). Desenho aprovado pelo Matheus em 24/10/2026
-- (erp-o2/FASE-0-FUNDACAO-ERP-O2.pdf). Princípios:
--   * nada de cadastro paralelo: produtor = imobiliarias.id, cliente = locatarios.id,
--     PDF = apolice_documentos.id, boleto = faturas.id, envio = repasses_envios.id;
--   * API-first: toda entidade guarda código externo (Corp hoje; plataforma Nichoos,
--     Superlógica, Base Software amanhã) em erp_chaves_externas;
--   * repasse ESPERADO (regra na ficha da imobiliária) × NEGOCIADO (valor no documento);
--   * mês fechado congela (erp_retrato_mensal) — igual ao espelho do Corp;
--   * RLS com (select is_colaborador_o2()) em todas as tabelas desde a criação.
-- Carga inicial: função erp_importar_corp(), que lê o ESPELHO já no banco
-- (corp_grade / corp_documentos / producao_unificada / imobiliaria_registros_fonte),
-- não a exportação do Corp (que trava). Reexecutável (upsert por nosso_numero_corp).

-- ============================================================ cadastros
create table if not exists erp_corretoras (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  cnpj text unique,
  susep text,
  apelido text not null unique,                  -- 'O2 Corretora' | 'O2 Capitalização'
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists erp_seguradoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  abreviacao text not null unique,               -- POTT, TOKI, PORT, YELU, BRAS, TOO...
  codigo_corp text unique,                       -- id_seguradora do Corp
  cnpj text,
  email_cobranca text,
  email_demonstrativo text,
  regra_senha_pdf text,
  canal_demonstrativo text not null default 'portal'
    check (canal_demonstrativo in ('email_xls','portal','api','nenhum')),
  dia_fixo_parcela int,                          -- Tokio/Pottencial 15, Too 13, Porto 10 (manual da equipe)
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists erp_ramos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  abreviacao text not null unique,               -- FIAN, 2FIA, IMOB, 2IMO, CAP, CAP2, RESI...
  produto text not null check (produto in
    ('fianca','incendio','capitalizacao','automovel','condominio','vida','saude','rc','portateis','viagem','pet','outros')),
  grupo_corp text,                               -- agrupamento_pai do Power BI
  pct_iof numeric(5,2),
  renovavel boolean not null default true,
  corretora_id uuid references erp_corretoras(id),   -- prefixo "2" = segunda SUSEP
  codigo_corp text unique,
  created_at timestamptz not null default now()
);

create table if not exists erp_coberturas (
  id uuid primary key default gen_random_uuid(),
  seguradora_id uuid references erp_seguradoras(id),
  ramo_id uuid references erp_ramos(id),
  nome text not null,
  agrupamento text,
  padrao boolean not null default false,
  codigo_corp text,
  unique (seguradora_id, ramo_id, nome)
);

create table if not exists erp_formas_pagamento (
  codigo text primary key,                       -- cheque, boleto, debito, cartao, dinheiro, pix
  nome text not null,
  ordem int not null default 0
);

-- Parâmetros globais (ex.: retenção de imposto no repasse = 18 = 5% ISS + 13% federais)
create table if not exists erp_parametros (
  chave text primary key,
  valor jsonb not null,
  descricao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por_email text
);

-- Regra ESPERADA de repasse, negociada na parceria (fica na ficha da imobiliária).
create table if not exists erp_repasse_regras (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references imobiliarias(id) on delete cascade,
  seguradora_id uuid references erp_seguradoras(id),   -- null = PADRÃO (curinga)
  ramo_id uuid references erp_ramos(id),               -- null = PADRÃO (curinga)
  base_calculo text not null default 'premio_liquido' check (base_calculo in
    ('valor_fixo','premio_liquido','liquido_adicional','premio_total','base_comissao','comissao_corretora')),
  pct_novo numeric(9,4) not null default 0,
  pct_renovado numeric(9,4) not null default 0,
  valor_fixo numeric(14,2),
  forma_repasse text not null default 'parcelado' check (forma_repasse in ('parcelado','tudo_1a','proporcional_comissao')),
  premiacao_valor numeric(14,2),
  pct_retencao_imposto numeric(5,2),             -- null = usa o parâmetro global
  vigente_de date not null default current_date,
  vigente_ate date,
  origem text not null default 'manual' check (origem in ('manual','corp_import')),
  observacao text,
  created_at timestamptz not null default now(),
  criado_por_email text
);
create index if not exists erp_repasse_regras_imob_idx on erp_repasse_regras(imobiliaria_id);

create table if not exists erp_repasse_indiretos (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_chefe_id uuid not null references imobiliarias(id) on delete cascade,
  imobiliaria_subordinada_id uuid not null references imobiliarias(id) on delete cascade,
  base_calculo text not null default 'comissao_corretora',
  pct_novo numeric(9,4) not null default 0,
  pct_renovado numeric(9,4) not null default 0,
  vigente_de date not null default current_date,
  vigente_ate date,
  unique (imobiliaria_chefe_id, imobiliaria_subordinada_id, vigente_de)
);

-- ============================================================ núcleo
create sequence if not exists erp_nosso_numero_seq start 200000;   -- acima do último do Corp (~134 mil)

create table if not exists erp_documentos (
  id uuid primary key default gen_random_uuid(),
  nosso_numero bigint not null unique default nextval('erp_nosso_numero_seq'),
  nosso_numero_corp bigint unique,               -- preservado para sempre
  corretora_id uuid references erp_corretoras(id),
  tipo char(1) not null default 'A' check (tipo in ('A','C','D','F','I','M','R','X')),
  tipo_corp text check (tipo_corp in ('NOVO','RENV','END','FAT','CANC')),   -- novo × renovado (regra do PBI)
  seguradora_id uuid references erp_seguradoras(id),
  ramo_id uuid references erp_ramos(id),
  locatario_id uuid references locatarios(id),   -- cliente/segurado
  imobiliaria_principal_id uuid references imobiliarias(id),
  canal_venda text,                              -- segimob | superlogica | base_software | retransmissao | tombamento | venda_direta
  numero_proposta text,
  numero_apolice text,
  numero_endosso text,
  motivo_endosso text,
  documento_pai_id uuid references erp_documentos(id),        -- endosso → apólice
  documento_renovado_id uuid references erp_documentos(id),   -- renovação → documento anterior
  dt_proposta date,
  dt_emissao date,
  vigencia_inicio date,
  vigencia_fim date,
  forma_pagamento text references erp_formas_pagamento(codigo),
  qtd_parcelas int,
  prazo_1a_dias int,
  dia_fixo int,
  premio_liquido numeric(14,2) not null default 0,
  premio_adicional numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  custo_apolice numeric(14,2) not null default 0,    -- só histórico do Corp (não existe mais)
  iof numeric(14,2) not null default 0,
  premio_total numeric(14,2) not null default 0,
  comissao_base text not null default 'premio_liquido',
  comissao_pct numeric(9,4) not null default 0,
  comissao_valor numeric(14,2) not null default 0,
  premiacao_valor numeric(14,2) not null default 0,
  situacao text not null default 'digitado' check (situacao in
    ('digitado','emitido','vigente','vencido','cancelado','devolvido')),
  cancelado_em date,
  motivo_cancelamento text,
  competencia date not null,                     -- 1º dia do mês de início de vigência
  congelado boolean not null default false,
  fora_regra_pbi boolean not null default false, -- documento sem linha incluir_corretora no espelho
  origem text not null default 'manual' check (origem in ('corp_import','bitrix','manual','api')),
  origem_ref text,
  observacoes text,
  digitado_por text,
  digitado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  criado_por_email text
);
create index if not exists erp_documentos_corp_idx on erp_documentos(nosso_numero_corp);
create index if not exists erp_documentos_locatario_idx on erp_documentos(locatario_id);
create index if not exists erp_documentos_imob_idx on erp_documentos(imobiliaria_principal_id);
create index if not exists erp_documentos_comp_idx on erp_documentos(competencia, ramo_id, seguradora_id);
create index if not exists erp_documentos_fim_idx on erp_documentos(vigencia_fim);
create index if not exists erp_documentos_apolice_idx on erp_documentos(numero_apolice);

-- Produtores do documento: participação e repasse NEGOCIADO (pode diferir da regra esperada)
create table if not exists erp_documento_produtores (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  imobiliaria_id uuid references imobiliarias(id),
  produtor_corp_codigo int,
  produtor_corp_nome text,
  agente text not null default 'imob' check (agente in ('imob','parceiro','pessoa','canal','marcador','o2')),
  principal boolean not null default false,
  pct_participacao numeric(9,4) not null default 100,
  indireto boolean not null default false,
  repasse_base text not null default 'premio_liquido',
  repasse_pct numeric(9,4) not null default 0,       -- negociado neste documento
  repasse_valor_previsto numeric(14,2) not null default 0,
  repasse_pct_esperado numeric(9,4),                 -- o que a regra da ficha dizia (comparação)
  motivo_diferenca text,
  forma_repasse text not null default 'parcelado',
  premiacao_valor numeric(14,2) not null default 0,
  regra_id uuid references erp_repasse_regras(id)
);
create index if not exists erp_doc_prod_doc_idx on erp_documento_produtores(documento_id);
create index if not exists erp_doc_prod_imob_idx on erp_documento_produtores(imobiliaria_id);

create table if not exists erp_documento_itens (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  item_n int not null default 1,
  tipo_imovel text check (tipo_imovel in ('residencial','comercial')),
  assistencia_juridica boolean,
  contrato_inicio date,
  contrato_fim date,
  cep text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text,
  valor_aluguel numeric(14,2),
  plano text,
  observacoes text,
  placa text, chassi text, veiculo text,
  unique (documento_id, item_n)
);

create table if not exists erp_item_partes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references erp_documento_itens(id) on delete cascade,
  papel text not null check (papel in ('garantido','locatario','proprietario','condutor','beneficiario')),
  locatario_id uuid references locatarios(id),
  nome text,
  documento_numero text,
  ordem int not null default 1
);

create table if not exists erp_item_coberturas (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references erp_documento_itens(id) on delete cascade,
  cobertura_id uuid references erp_coberturas(id),
  nome text not null,
  importancia_segurada numeric(14,2),
  taxa numeric(9,4),
  premio numeric(14,2),
  franquia numeric(14,2)
);

create table if not exists erp_parcelas (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  n int not null,
  vencimento date not null,
  valor numeric(14,2) not null default 0,
  forma_pagamento text,
  quitada_em date,
  valor_quitado numeric(14,2),
  fatura_id uuid references faturas(id),
  origem text not null default 'manual' check (origem in ('manual','regra','estimada_corp','api')),
  unique (documento_id, n)
);
create index if not exists erp_parcelas_venc_idx on erp_parcelas(vencimento);

create table if not exists erp_comissoes (
  id uuid primary key default gen_random_uuid(),
  parcela_id uuid not null references erp_parcelas(id) on delete cascade,
  tipo text not null default 'comissao' check (tipo in ('comissao','premiacao')),
  base numeric(14,2),
  pct numeric(9,4),
  valor_previsto numeric(14,2) not null default 0,
  previsao_recebimento date,
  status text not null default 'prevista' check (status in ('prevista','recebida','parcial','divergente','cancelada'))
);
create index if not exists erp_comissoes_parcela_idx on erp_comissoes(parcela_id);

create table if not exists erp_extratos_seguradora (
  id uuid primary key default gen_random_uuid(),
  seguradora_id uuid references erp_seguradoras(id),
  corretora_id uuid references erp_corretoras(id),
  competencia date,
  tipo text not null check (tipo in ('demonstrativo','comissoes_pagas','comissoes_emitidas','inadimplencia','restituicao','pro_labore')),
  origem text not null default 'upload' check (origem in ('gmail','upload','portal','api')),
  gmail_message_id text,
  arquivo_path text,
  linhas jsonb not null default '[]'::jsonb,
  total_bruto numeric(14,2),
  total_liquido numeric(14,2),
  nf_numero text,
  nf_emitida_em date,
  pago_em date,
  conciliado_em timestamptz,
  observacao text,
  created_at timestamptz not null default now()
);

create table if not exists erp_comissao_recebimentos (
  id uuid primary key default gen_random_uuid(),
  comissao_id uuid not null references erp_comissoes(id) on delete cascade,
  recebido_em date not null,
  valor_recebido numeric(14,2) not null,
  origem text not null default 'manual' check (origem in ('extrato','portal','manual','nibo','ofx')),
  extrato_id uuid references erp_extratos_seguradora(id),
  extrato_linha int,
  diferenca numeric(14,2),
  conferido_por_email text,
  observacao text,
  created_at timestamptz not null default now()
);

create table if not exists erp_parcelas_inadimplencia (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid references erp_documentos(id),
  parcela_id uuid references erp_parcelas(id),
  seguradora_id uuid references erp_seguradoras(id),
  numero_apolice text,
  parcela_n int,
  parcela_total int,
  lote text,
  titulo text,
  imobiliaria_id uuid references imobiliarias(id),
  comunicado_n int,
  data_comunicado date,
  vencimento_original date,
  valor numeric(14,2),
  origem text not null default 'manual' check (origem in ('email_tokio','email_pottencial','email_allianz','portal','manual')),
  gmail_message_id text,
  situacao text not null default 'aberta' check (situacao in ('aberta','regularizada','cancelada_por_inadimplencia')),
  regularizada_em date,
  created_at timestamptz not null default now()
);

create table if not exists erp_repasse_lotes (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references imobiliarias(id),
  competencia date not null,
  total_bruto numeric(14,2) not null default 0,
  total_retido numeric(14,2) not null default 0,
  total_liquido numeric(14,2) not null default 0,
  gerado_em timestamptz not null default now(),
  pago_em date,
  comprovante_path text,
  relatorio_path text,
  repasse_envio_id uuid references repasses_envios(id),
  status text not null default 'aberto' check (status in ('aberto','pago','enviado','cancelado'))
);

create table if not exists erp_repasses (
  id uuid primary key default gen_random_uuid(),
  documento_produtor_id uuid not null references erp_documento_produtores(id) on delete cascade,
  comissao_recebimento_id uuid references erp_comissao_recebimentos(id),  -- null = antecipação
  imobiliaria_id uuid not null references imobiliarias(id),
  tipo text not null default 'comissao' check (tipo in ('comissao','premiacao')),
  competencia date not null,
  valor_bruto numeric(14,2) not null default 0,
  pct_retencao numeric(5,2) not null default 0,
  valor_retido numeric(14,2) not null default 0,
  valor_liquido numeric(14,2) not null default 0,
  previsao date,
  status text not null default 'pendente' check (status in ('pendente','em_lote','pago','cancelado','renegociado')),
  lote_id uuid references erp_repasse_lotes(id),
  antecipado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists erp_repasses_imob_idx on erp_repasses(imobiliaria_id, status);

create table if not exists erp_repasse_ajustes (
  id uuid primary key default gen_random_uuid(),
  repasse_id uuid not null references erp_repasses(id) on delete cascade,
  tipo text not null check (tipo in ('erro_operacional','renegociacao','parcelamento','antecipacao','estorno','outro')),
  valor numeric(14,2) not null,
  parcela_n int, parcela_total int,
  motivo text not null,
  autorizado_por_email text,
  comprovante_path text,
  created_at timestamptz not null default now()
);

create table if not exists erp_documento_eventos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  tipo text not null check (tipo in ('digitado','enviado_seguradora','emitido','apolice_recebida','enviado_cliente',
    'enviado_imobiliaria','entregue','assinado','renovacao_aberta','renovado','nao_renovado','cancelado','endossado','importado')),
  data timestamptz not null default now(),
  canal text,
  destinatario text,
  usuario_email text,
  detalhes jsonb not null default '{}'::jsonb
);
create index if not exists erp_doc_eventos_doc_idx on erp_documento_eventos(documento_id);

create table if not exists erp_documento_anexos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  tipo text not null default 'outro' check (tipo in ('apolice','proposta','endosso','boleto','certificado','outro')),
  apolice_documento_id uuid references apolice_documentos(id),
  storage_path text,
  nome_arquivo text,
  origem text not null default 'upload' check (origem in ('corp','email','drive','upload','api')),
  created_at timestamptz not null default now()
);

create table if not exists erp_renovacoes (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  vence_em date not null,
  status text not null default 'a_renovar' check (status in ('a_renovar','em_cotacao','renovado','nao_renovado','cancelado')),
  motivo text,
  bitrix_card_id text,
  documento_novo_id uuid references erp_documentos(id),
  responsavel_email text,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- API-first: códigos de qualquer sistema externo para qualquer entidade do ERP
create table if not exists erp_chaves_externas (
  id uuid primary key default gen_random_uuid(),
  sistema text not null,                         -- corp | nichoos | superlogica | base_software | segimob | bitrix | nibo
  entidade text not null,                        -- documento | imobiliaria | locatario | parcela | repasse
  entidade_id uuid not null,
  chave text not null,
  dados jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (sistema, entidade, chave)
);
create index if not exists erp_chaves_externas_ent_idx on erp_chaves_externas(entidade, entidade_id);

-- Retrato mensal congelado (mesma lógica de corp_retrato_producao)
create table if not exists erp_retrato_mensal (
  competencia date not null,
  corretora_id uuid,
  ramo_id uuid,
  seguradora_id uuid,
  tipo_corp text,
  cancelado boolean not null default false,
  documentos int not null default 0,
  premio_liquido numeric(14,2) not null default 0,
  premio_total numeric(14,2) not null default 0,
  comissao numeric(14,2) not null default 0,
  premiacao numeric(14,2) not null default 0,
  congelado boolean not null default false,
  gravado_em timestamptz not null default now(),
  primary key (competencia, corretora_id, ramo_id, seguradora_id, tipo_corp, cancelado)
);

create table if not exists erp_auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id uuid,
  operacao text not null,
  antes jsonb,
  depois jsonb,
  usuario_email text,
  em timestamptz not null default now()
);
create index if not exists erp_auditoria_reg_idx on erp_auditoria(tabela, registro_id);

create table if not exists erp_acesso_clientes_log (
  id bigint generated always as identity primary key,
  locatario_id uuid not null,
  usuario_email text not null,
  tela text,
  em timestamptz not null default now()
);

-- ============================================================ auditoria genérica
create or replace function erp_auditar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into erp_auditoria (tabela, registro_id, operacao, antes, depois, usuario_email)
  values (tg_table_name,
          nullif(coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id', ''), '')::uuid,
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          coalesce(auth.jwt() ->> 'email', current_user));
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);   -- auditoria nunca pode impedir a operação
end $$;

do $$
declare t text;
begin
  foreach t in array array['erp_documentos','erp_documento_produtores','erp_parcelas','erp_comissoes',
    'erp_comissao_recebimentos','erp_repasses','erp_repasse_ajustes','erp_repasse_lotes','erp_repasse_regras','erp_renovacoes']
  loop
    execute format('drop trigger if exists %I on %I', t || '_aud', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function erp_auditar()', t || '_aud', t);
  end loop;
end $$;

create or replace function erp_tocar_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists erp_documentos_upd on erp_documentos;
create trigger erp_documentos_upd before update on erp_documentos for each row execute function erp_tocar_updated_at();
drop trigger if exists erp_renovacoes_upd on erp_renovacoes;
create trigger erp_renovacoes_upd before update on erp_renovacoes for each row execute function erp_tocar_updated_at();

-- ============================================================ RLS (equipe O2 = acesso total; decisão 2 do Matheus)
do $$
declare t text;
begin
  foreach t in array array['erp_corretoras','erp_seguradoras','erp_ramos','erp_coberturas','erp_formas_pagamento','erp_parametros',
    'erp_repasse_regras','erp_repasse_indiretos','erp_documentos','erp_documento_produtores','erp_documento_itens','erp_item_partes',
    'erp_item_coberturas','erp_parcelas','erp_comissoes','erp_extratos_seguradora','erp_comissao_recebimentos','erp_parcelas_inadimplencia',
    'erp_repasse_lotes','erp_repasses','erp_repasse_ajustes','erp_documento_eventos','erp_documento_anexos','erp_renovacoes',
    'erp_chaves_externas','erp_retrato_mensal','erp_auditoria','erp_acesso_clientes_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_o2', t);
    execute format('create policy %I on %I for all to authenticated using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()))', t || '_o2', t);
  end loop;
end $$;

-- Cofre de clientes: leitura liberada para a equipe (decisão 2), escrita continua só pelo sistema
drop policy if exists locatarios_leitura_o2 on locatarios;
create policy locatarios_leitura_o2 on locatarios for select to authenticated using ((select is_colaborador_o2()));
grant select on locatarios to authenticated;   -- sem o GRANT a policy não vale (achado no teste da tela, 24/10)

-- ============================================================ sementes
insert into erp_corretoras (razao_social, cnpj, apelido) values
  ('O2 CORRETORA DE SEGUROS LTDA', '20.001.784/0001-80', 'O2 Corretora'),
  ('O2 CAPITALIZACAO E SEGUROS LTDA', null, 'O2 Capitalização')
on conflict (apelido) do nothing;

insert into erp_formas_pagamento (codigo, nome, ordem) values
  ('cheque','Cheque',1), ('boleto','Boleto Bancário',2), ('debito','Débito em Conta',3),
  ('cartao','Cartão de Crédito',4), ('dinheiro','Dinheiro',5), ('pix','PIX',6)
on conflict (codigo) do nothing;

insert into erp_parametros (chave, valor, descricao) values
  ('repasse.pct_retencao_imposto', '18', 'Retenção padrão no repasse: 5% ISS + 13% federais (manual Repasse ao Produtor). Repasses fixos e premiação de campanha não sofrem retenção.'),
  ('repasse.prazo', '"ate o fim do mes seguinte ao recebimento da comissao"', 'Manual Repasse ao Produtor'),
  ('baixa.previsao_repasse_dia', '15', 'Data de previsão de repasse = dia 15 do mês seguinte (manual Baixa de Comissão)')
on conflict (chave) do nothing;

-- seguradoras: espelho do Corp (corp_regra_seguradora) + dia fixo conhecido
insert into erp_seguradoras (nome, abreviacao, codigo_corp, dia_fixo_parcela, canal_demonstrativo)
select r.seguradora, r.id_seguradora, r.id_seguradora,
       case r.id_seguradora when 'TOKI' then 15 when 'POTT' then 15 when 'TOO' then 13 when 'PORT' then 10 when 'PESS' then 10 end,
       case r.id_seguradora when 'POTT' then 'email_xls' when 'TOO' then 'email_xls' when 'ALLI' then 'email_xls' else 'portal' end
from corp_regra_seguradora r
on conflict (abreviacao) do nothing;
-- seguradoras que aparecem na grade mas não estão na lista do PBI
insert into erp_seguradoras (nome, abreviacao, codigo_corp)
select distinct g.seg, g.seg, g.seg from corp_grade g where g.seg is not null and not exists (select 1 from erp_seguradoras s where s.abreviacao = g.seg)
on conflict (abreviacao) do nothing;

insert into erp_ramos (nome, abreviacao, codigo_corp, grupo_corp, produto, renovavel, corretora_id)
select r.descricao, r.id_ramo, r.id_ramo, r.agrupamento_pai,
  case
    when r.id_ramo in ('FIAN','2FIA') then 'fianca'
    when r.id_ramo in ('CAP','CAP2') then 'capitalizacao'
    when r.id_ramo in ('IMOB','2IMO','RESI','EMPR','BIKE','CCOM','CRES') then 'incendio'
    when r.id_ramo = 'COND' then 'condominio'
    when r.id_ramo = 'AUTO' then 'automovel'
    when r.id_ramo in ('VIND','VGRP','VDCV','API','PREV','PRES') then 'vida'
    when r.id_ramo in ('SAUD','ODO','ADES') then 'saude'
    when r.id_ramo = 'PET' then 'pet'
    when r.id_ramo in ('RC','RCP') then 'rc'
    when r.id_ramo in ('PORT','2POR') then 'portateis'
    when r.id_ramo = 'VIAG' then 'viagem'
    else 'outros' end,
  r.id_ramo not in ('PET','PRES','PREM'),
  (select id from erp_corretoras where apelido = case when r.id_ramo in ('2FIA','2IMO','2POR','CAP2') then 'O2 Capitalização' else 'O2 Corretora' end)
from corp_regra_ramo r
on conflict (abreviacao) do nothing;
insert into erp_ramos (nome, abreviacao, codigo_corp, produto)
select distinct g.ramo, g.ramo, g.ramo, 'outros' from corp_grade g where g.ramo is not null and not exists (select 1 from erp_ramos x where x.abreviacao = g.ramo)
on conflict (abreviacao) do nothing;

-- Carga do espelho do Corp e inferência das regras de repasse: ver schema_erp_fase0_carga.sql
-- (rodar por fatia de ano; a carga inteira de uma vez encheu o disco do Supabase em 24/10/2026).

-- Retrato mensal: mês fechado só grava uma vez (congelado); mês aberto recalcula
create or replace function erp_atualizar_retrato() returns void language plpgsql security definer set search_path = public as $$
begin
  delete from erp_retrato_mensal where not congelado;
  insert into erp_retrato_mensal (competencia, corretora_id, ramo_id, seguradora_id, tipo_corp, cancelado, documentos, premio_liquido, premio_total, comissao, premiacao, congelado)
  select d.competencia, d.corretora_id, d.ramo_id, d.seguradora_id, coalesce(d.tipo_corp, 'NOVO'), d.situacao = 'cancelado',
         count(*), sum(d.premio_liquido), sum(d.premio_total), sum(d.comissao_valor), sum(d.premiacao_valor),
         d.competencia < date_trunc('month', current_date)::date
  from erp_documentos d
  where not d.fora_regra_pbi
    and not exists (select 1 from erp_retrato_mensal r where r.competencia = d.competencia and r.congelado)
  group by 1, 2, 3, 4, 5, 6
  on conflict (competencia, corretora_id, ramo_id, seguradora_id, tipo_corp, cancelado) do nothing;
end $$;

-- Conferência contra o espelho do Power BI (corp_retrato_producao, base corretora)
create or replace view erp_conferencia_corp with (security_invoker = true) as
with corp as (
  select mes::date as mes, ramo, seg, sum(documentos) as documentos, sum(pr_liquido) as pr_liquido, sum(vl_com) as vl_com
  from corp_retrato_producao where base = 'corretora' group by 1, 2, 3
), erp as (
  select d.competencia as mes, r.abreviacao as ramo, s.abreviacao as seg, count(*) as documentos,
         sum(d.premio_liquido) as pr_liquido, sum(d.comissao_valor) as vl_com
  from erp_documentos d
  left join erp_ramos r on r.id = d.ramo_id
  left join erp_seguradoras s on s.id = d.seguradora_id
  where d.origem = 'corp_import' and not d.fora_regra_pbi
  group by 1, 2, 3
)
select coalesce(c.mes, e.mes) as mes, coalesce(c.ramo, e.ramo) as ramo, coalesce(c.seg, e.seg) as seg,
       c.documentos as corp_docs, e.documentos as erp_docs,
       c.pr_liquido as corp_premio, e.pr_liquido as erp_premio,
       c.vl_com as corp_comissao, e.vl_com as erp_comissao,
       coalesce(e.documentos, 0) - coalesce(c.documentos, 0) as dif_docs,
       coalesce(e.vl_com, 0) - coalesce(c.vl_com, 0) as dif_comissao
from corp c full join erp e on e.mes = c.mes and e.ramo = c.ramo and e.seg = c.seg;

grant select on erp_conferencia_corp to authenticated;
