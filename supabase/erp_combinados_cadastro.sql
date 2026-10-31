-- ERP O2 — combinados de cadastro (31/10/2026): dados estruturados das mensagens das tarefas "CADASTRO … CORP" do Bitrix.
-- Fonte: tarefa Bitrix (nível 3 do guia de fontes; o PDF da proposta, quando ligado, é nível 1). NUNCA guarda o texto bruto da mensagem.
-- Imobiliária só liga à tabela única `imobiliarias` (nunca cria); nome que não casa fica só em imobiliaria_nome.
create table if not exists erp_combinados_cadastro (
  id uuid primary key default gen_random_uuid(),
  tarefa_id bigint not null,
  mensagem_id bigint not null,
  data_mensagem timestamptz,
  setor text,                 -- FIANCA, CAPITALIZACAO, ENDOSSO, RENOVACAO, INCENDIO, DEMAIS_RAMOS, OUTRO
  titulo_tarefa text,
  imobiliaria_nome text,
  imobiliaria_id uuid references imobiliarias(id),
  segurado_nome text,
  seg_numero text,            -- "SEG:" da mensagem (nº da proposta/apólice como escrito)
  vigencia_ini date,
  vigencia_fim date,
  seguradora_plano text,
  comissao_pct numeric,
  repasse_pct numeric,
  repasse_valor numeric,
  sem_repasse boolean not null default false,
  pro_labore_status text check (pro_labore_status in ('com','sem')),
  pro_labore_pct numeric,
  pro_labore_valor numeric,
  n_arquivos int not null default 0,
  fonte text not null default 'tarefa Bitrix',
  nivel int not null default 3,
  documento_id uuid references erp_documentos(id),   -- preenchido só com 1 candidato certo (guia de fontes)
  ligacao text,               -- como ligou: proposta | nome+vigencia | pdf ...; vazio = sem ligação
  lido_em timestamptz not null default now(),
  unique (tarefa_id, mensagem_id)
);
create index if not exists erp_combinados_documento_idx on erp_combinados_cadastro(documento_id);
create index if not exists erp_combinados_imobiliaria_idx on erp_combinados_cadastro(imobiliaria_id);
alter table erp_combinados_cadastro enable row level security;
drop policy if exists erp_combinados_colab on erp_combinados_cadastro;
create policy erp_combinados_colab on erp_combinados_cadastro for all using (is_colaborador_o2()) with check (is_colaborador_o2());
