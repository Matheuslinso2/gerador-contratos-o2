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

-- 03/11/2026: p_empresa aceita 'corretora' | 'capitalizacao' | 'consolidado' (soma categoria a categoria, mesma árvore). Migração "erp_nibo_painel_consolidado".
-- Conferido: consolidado = corretora + capitalizacao (ex.: receita de seguros set/2026 191.345 + 195.563 = 386.908; resultado A+B+C set −65.005 + 22.247 = −42.758).
-- Atenção: transferência entre as duas empresas, se vier categorizada como receita/despesa, contaria em dobro no consolidado; hoje fica em FORA DO PAINEL (sem categoria).

-- 03/11/2026 (2): códigos por empresa — corretora usa "5.1 - NOVAS RECEITAS", capitalização "2.1 - NOVAS RECEITAS" (linhas em erp_nibo_painel_estrutura com a coluna empresa). No consolidado aparecem as duas, cada uma com o seu código.
-- Conferido contra o print da corretora (jul–out/2026): receita de seguros 208.060 / 222.324 / 191.345 / 176.843, novas receitas set 20 e out 36 — iguais. Migração "erp_nibo_painel_codigos_por_empresa".

-- 03/11/2026 (3): INDICADORES de apoio ao painel (o espelho do Nibo NÃO muda), a partir dos livros "Finanças Empresariais" (FAE) e "Gestão de Empresas" (CRCRJ):
-- erp_nibo_painel_indicadores(p_ano, p_empresa) -> ordem, indicador, rotulo, unidade, m01..m12, total, base_conceitual.
-- Margem de contribuição e %, despesas (C) % da receita, ponto de equilíbrio (despesas ÷ margem %), folga sobre o ponto de equilíbrio, resultado operacional e %, movimento fora do painel,
-- fluxo de caixa do mês e acumulado. O acumulado só é confiável com o histórico de jan–jun carregado. Migração "erp_nibo_painel_indicadores".

-- 03/11/2026 (4): histórico de 2026 carregado (erp_nibo_historico_estado concluído; 141 categorias em erp_nibo_categorias — a API devolve lista plana: sem categoria-pai nem código, só in/out).
-- Conferido contra o print da corretora jan–jun/2026 e totais do ano: receitas operacionais 2.144.706, custos −546.981, margem 1.597.724, despesas (C) −2.110.148 — IGUAIS depois de tirar
-- "9.1 - AQUISIÇÃO DE EQUIPAMENTOS" do bloco C (era 1.898 a mais; no Nibo é investimento, fora das despesas operacionais): fica em FORA DO PAINEL.

-- 03/11/2026 (5): ESTUDO da carga tributária (Simples Nacional nas duas empresas) — erp-o2/ESTUDO-CARGA-TRIBUTARIA-O2-SIMPLES-NACIONAL.pdf.
-- erp_simples_tabela (Anexos III e V, editável) e erp_simples_estimativa(p_empresa, p_ano): por mês, receita, RBT12, Fator R, anexo, alíquota efetiva, DAS esperado × DAS pago no mês seguinte (a partir do Nibo, caixa).
-- É ESTIMATIVA; só confiável quando os 12 meses anteriores estiverem carregados (meses_de_dados_12m = 12 e folha completa). Migração "erp_simples_estimativa".
