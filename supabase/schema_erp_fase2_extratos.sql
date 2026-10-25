-- ERP O2 — Fase 2 (25/10/2026): extratos/demonstrativos de comissão das seguradoras.
-- Aplicado via MCP apply_migration: erp_fase2_extratos_comissao, erp_fase2_extratos_ajustes, erp_fase2_extratos_resumo_view.
-- Fontes (Gmail do Matheus, conta de serviço do /gestao-emails; código em src/lib/erp/extratos.ts):
--   Pottencial "Dem Com. Nº" mensal (XLS, 1 linha por apólice × parcela, 2 corretoras O2);
--   Too "Demonstrativo de Comissão - Too Seguros" semanal (XLS); Tokio "Valores para Emissão da Nota Fiscal"
--   mensal (SÓ total do mês → tipo resumo_mensal); Porto/Yelum não mandam extrato por e-mail (portal).
-- Carga: scripts/erp/carregar-extratos.ts [--gravar] e cron /api/cron/erp-bitrix?spa=1048 (1×/h, últimos 12 dias).

create table if not exists erp_extrato_linhas (
  id uuid primary key default gen_random_uuid(),
  extrato_id uuid not null references erp_extratos_seguradora(id) on delete cascade,
  seguradora text not null,
  n int not null,
  tipo text, apolice text, proposta text, endosso text, parcela int,
  cliente text, cpf_cnpj text, premio numeric, pct_comissao numeric, valor_comissao numeric,
  vigencia_inicio date, produto text,
  documento_id uuid references erp_documentos(id) on delete set null,
  parcela_id uuid references erp_parcelas(id) on delete set null,
  casado_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists erp_extrato_linhas_extrato_idx on erp_extrato_linhas(extrato_id);
create index if not exists erp_extrato_linhas_doc_idx on erp_extrato_linhas(documento_id);
create index if not exists erp_extrato_linhas_apolice_idx on erp_extrato_linhas(seguradora, apolice);
alter table erp_extrato_linhas enable row level security;
create policy colab_all on erp_extrato_linhas for all to authenticated using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));
-- RLS de colaborador também em erp_extratos_seguradora e erp_comissao_recebimentos (Fase 1 criou sem policy)
alter table erp_extratos_seguradora drop constraint if exists erp_extratos_seguradora_tipo_check;
alter table erp_extratos_seguradora add constraint erp_extratos_seguradora_tipo_check
  check (tipo in ('demonstrativo','comissoes_pagas','comissoes_emitidas','inadimplencia','restituicao','pro_labore','resumo_mensal'));
alter table erp_comissao_recebimentos add column if not exists extrato_linha_id uuid references erp_extrato_linhas(id) on delete cascade;
create unique index if not exists erp_comissao_recebimentos_linha_uk on erp_comissao_recebimentos(extrato_linha_id) where extrato_linha_id is not null;

-- erp_cruzar_extratos(): casa linha → documento (Pottencial manda a apólice completa 0306920269907460575738000
-- e o Corp guarda o final 575738000; Too igual ao Corp), linha → parcela (nº), cria erp_comissao_recebimentos
-- (origem 'extrato', diferenca = recebido − previsto) e marca modo_cobranca = 'boleto' em quem apareceu no
-- extrato mas em nenhuma fatura carregada da imob × seguradora (imob com fatura ativa); depois erp_inferir_administrado().
-- (corpo completo na migration erp_fase2_extratos_ajustes)

-- erp_extratos_resumo (view): 1 linha por extrato com contagem de linhas / casadas / com parcela (tela /erp/conferencia).
-- erp_fora_das_ultimas_faturas ganhou a coluna no_extrato (apareceu no extrato = pago fora da fatura).

-- Resultado da 1ª carga (25/10): Pottencial 6 demonstrativos (105 linhas), Too 18 (229 linhas), Tokio 2 resumos;
-- 334/334 linhas casadas com documento, 331 com parcela; comissão igual ao previsto em 284 (86%);
-- 17 apólices da Too marcadas boleto (no extrato, fora da fatura).

-- Ajustes (mesmo dia, migration erp_fase2_fora_faturas_pronto):
--   • extratos duplicados por e-mail encaminhado ("Fwd:" com o mesmo anexo) removidos; índice único (seguradora_id, arquivo_path);
--     o leitor deduplica pelo nome do arquivo, não pela mensagem.
--   • "Fora das últimas faturas" virou tabela pronta erp_fora_faturas_pronto (a view estourava o tempo da página),
--     refeita por erp_atualizar_fora_faturas() ao fim de erp_cruzar_faturas_carregadas() e erp_cruzar_extratos().
--   • erp_contar_alertas_fatura(): contagem dos alertas em 1 consulta (a tela parava nas 1.000 linhas do Supabase).

-- ---------------------------------------------------------------------------
-- 25/10 — Controle de baixa de comissão (planilha do financeiro "CONTROLE BAIXA - 2024/25/26",
-- Drive 1vPCjICRczmkvHLLaOrZZ3yF44JKzlZBs): por mês × corretora (O2 Corretora 20.001.784 / O2 Cap 54.493.758)
-- × seguradora, CORP bruto → imposto retido % → líquido × NIBO líquido → diferença (+ colunas endosso/cadastro/status/obs).
-- Migration erp_fase2_baixa_comissao_corretora_imposto:
--   erp_corretoras.cnpj da O2 Cap preenchido; tabela erp_imposto_retido (corretora × seguradora → % observado na planilha:
--   5% maioria, Allianz 6,5%, Pottencial 1,5% só na Corretora, Tokio 2% só na Cap, Mapfre 2%, Bradesco 4%, Too/Brasilcap/Suhai 0);
--   erp_extratos_seguradora.corretora_id preenchido pelo assunto do e-mail (o leitor passa a gravar na carga);
--   view erp_baixa_comissao_mensal = lado ERP (extratos) por corretora × seguradora × mês com líquido esperado.
-- Achado: os extratos por e-mail cobrem só PARTE da comissão (ago/26: Pottencial e-mail 174 + 269 vs planilha 7.734 + 50.198;
-- Tokio resumo por e-mail = só a O2 Cap). A fonte completa hoje é a baixa no Corp (relatórios das seguradoras) e o Nibo.

-- ---------------------------------------------------------------------------
-- 25/10 — Pasta do Drive para extratos baixados dos sites das seguradoras (pedido do Matheus:
-- "pasta no drive já com as pastas divididas e bem intuitivas para download e leitura pelo sistema";
-- depois, API da seguradora). Pasta: BAIXA DE COMISSÃO / EXTRATOS DE COMISSÃO (o ERP lê daqui)
-- (id 1CWbgcf2V2DqYMiG_mCghoZsk6v8fR1EL, drive compartilhado da equipe; conta de serviço prospeccao-leitura só leitura)
--   └ O2 CORRETORA (CNPJ 20.001.784) / ALFA … ZURICH (17 seguradoras, nomes da planilha CONTROLE BAIXA)
--   └ O2 CAPITALIZAÇÃO (CNPJ 54.493.758) / BRASILCAP, ICATU, PORTO, POTTENCIAL, TOKIO, TOO
--   └ 00 LEIA-ME
-- Código: src/lib/erp/extratosDrive.ts (Pottencial/Too leitores fixos; planilha genérica por nome de coluna;
-- PDF/texto pela IA); cron /api/cron/erp-extratos-drive (xx:40, até 15 arquivos/rodada); script scripts/erp/carregar-extratos-drive.ts.
-- Migration erp_fase2_extratos_drive: origem 'drive'/'corp', coluna leitura ('ok'/'nao_lido'), erp_digitos_apolice(),
-- erp_cruzar_extratos() casando pela seguradora do extrato (qualquer seguradora) e nº do Corp contido no nº do extrato,
-- view erp_extratos_resumo com corretora/origem/leitura. Mesmo nome de arquivo já lido do e-mail não entra de novo.
