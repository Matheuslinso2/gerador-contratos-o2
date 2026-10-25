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
