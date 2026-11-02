-- ERP O2 — espelho do "Painel de acompanhamento" do Nibo (03/11/2026). SÓ LEITURA do Nibo. Aplicado no banco; este arquivo versiona a estrutura.
-- Regime de CAIXA: mês da data realizada (erp_nibo_lancamentos.data); recebimentos (+), pagamentos (−); lançamento com várias categorias é rateado pelo valor de cada categoria.
-- Empresa 'capitalizacao' = O2 CAPITALIZAÇÃO E SEGUROS LTDA (a do print); 'corretora' = O2 Corretora.
-- Conferido com o print do Matheus (jul–out/2026, capitalizacao): receita de seguros 219.892 / 187.591 / 195.563 / 201.387; novas receitas set 377; repasse-comissões −12.118 / −5.000 / −7.291 / −50 — IGUAIS.
-- jan–jun/2026 dependem do histórico do Nibo (cron horário erp-nibo, erp_nibo_historico_estado: desde 2026-01-01).

alter table public.erp_nibo_historico_estado add column if not exists ultimo_erro text, add column if not exists ultimo_erro_em timestamptz;

create table if not exists public.erp_nibo_categorias (
  empresa text not null, id text not null, nome text not null, codigo text, tipo text, pai_id text, arquivada boolean, bruto jsonb, sincronizado_em timestamptz not null default now(), primary key (empresa, id));
alter table public.erp_nibo_categorias enable row level security;
create policy erp_nibo_categorias_o2 on public.erp_nibo_categorias for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());

-- Estrutura do painel (editável): bloco A (receitas), B (custos), C (despesas) e FORA (empréstimos, estornos, aplicações — a confirmar com a árvore do Nibo)
create table if not exists public.erp_nibo_painel_estrutura (
  id serial primary key, bloco text not null check (bloco in ('A', 'B', 'C', 'FORA')), bloco_rotulo text not null, bloco_ordem int not null, categoria_nome text not null, rotulo text not null, ordem int not null, empresa text,
  unique (categoria_nome, empresa));
alter table public.erp_nibo_painel_estrutura enable row level security;
create policy erp_nibo_painel_estrutura_o2 on public.erp_nibo_painel_estrutura for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
-- (linhas iniciais: ver select * from erp_nibo_painel_estrutura — migração "erp_nibo_painel_base")

-- erp_nibo_painel(p_ano int, p_empresa text) -> bloco, bloco_ordem, linha_tipo (categoria|subtotal|margem|margem_pct|resultado), ordem, rotulo, categoria_nome, m01..m12, total
-- Definição vigente: select pg_get_functiondef('erp_nibo_painel'::regproc); migração "erp_nibo_painel_sql".
