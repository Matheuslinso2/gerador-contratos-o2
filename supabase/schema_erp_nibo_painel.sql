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

-- 03/11/2026 (6): FLUXO DE CAIXA em 3 atividades (artigo de DFC + Finanças p.48): erp_nibo_dfc(p_ano, p_empresa) -> operacional / investimento / financiamento / estornos / transferências, com variação do mês e acumulada.
-- erp_nibo_financiamento_contrapartes(p_ano, p_empresa): empréstimos, aportes e "estorno e devolução" por contraparte (Porto Seguro, entre as empresas O2, sócios, bancos, outros). Migrações "erp_nibo_dfc" e "erp_nibo_financiamento_contrapartes".
-- Achado jan–out/2026: corretora com caixa operacional −590 mil coberto por Porto (+313 mil líquido), sócios (+141 mil), capitalização (+162 mil); no consolidado o grupo queima ~427 mil e os recursos vêm da Porto (+313 mil) e dos sócios (+145 mil).

-- 03/11/2026 (7): RECLASSIFICAÇÃO GERENCIAL (Matheus): as 16 entradas Pix de William de Jesus e Fabricio Esteves na corretora ("Estorno e devolução" no Nibo, R$ 155.133) são RECEITA DE SEGUROS
-- (a Brasilcap paga a comissão por cartão de benefícios — Alelo — e o valor é transferido para a conta oficial quando necessário). Regras editáveis em erp_nibo_regras_reclass.
-- erp_nibo_lanc_g(p_gerencial) aplica as regras; erp_nibo_painel(ano, empresa) = ESPELHO do Nibo (não muda); erp_nibo_painel(ano, empresa, true) = gerencial.
-- erp_nibo_dfc, erp_nibo_painel_indicadores, erp_nibo_financiamento_contrapartes e erp_simples_estimativa passam a usar a visão gerencial. Migração "erp_nibo_reclassificacao_gerencial".
-- Efeito jan–out/2026 (corretora): receita operacional 2.155.008 -> 2.310.141; caixa operacional −590 mil -> −435 mil; no consolidado −427 mil -> −272 mil.

-- 03/11/2026 (8): CONSOLIDADO GERENCIAL elimina as movimentações entre a corretora e a capitalização (empréstimo, estorno/devolução, aporte com contraparte O2 CORRETORA / O2 CAPITALIZ…). Migração "erp_nibo_consolidado_elimina_entre_empresas".
-- Conferência jan–out/2026: a capitalização pagou 280.068 (ofertamento 209.068 + pagamento 71.000) e a corretora recebeu 280.068 — IGUAL; a corretora pagou 118.442 (117.591 + 851) e a capitalização recebeu 115.234 — diferença de R$ 3.208 a conciliar.

-- 03/11/2026 (9): ANÁLISE VERTICAL E HORIZONTAL (Finanças Empresariais / Gestão de Empresas): erp_nibo_analise(p_ano, p_empresa, p_gerencial default true) -> bloco, bloco_ordem, linha_tipo, ordem, rotulo, mes, valor,
-- pct_receita (vertical: linha ÷ TOTAL A do mês), var_mes_anterior_pct e var_ano_anterior_pct (horizontal; sobre o valor com sinal: positivo = melhorou, vale para receita e para custo). Migração "erp_nibo_analise_vertical_horizontal".
-- Regime de CAIXA (não é competência). Histórico do Nibo carregado desde 2021-11-01; competência vem preenchida (cap. 100%, corretora ~88%) para uma futura visão por competência.
-- Dado suspeito no Nibo (não corrigido, só leitura): recebimento Mapfre R$ 24,04 com data 7201-10-30 (competência 2019-10-30) — fica fora de qualquer ano.
-- Conferência DRE O2-2026.xlsx x painel (jan–jul/2026): tudo bate exceto R$ 160.000 de junho (Pix Porto Seguro 09/06 lançado como receita de seguros na DRE; no Nibo é Obtenção de empréstimo) e deslocamentos de mês em 3.1 e 7.1.

-- 03/11/2026 (10): SEGURANÇA — dados financeiros da O2 (Nibo, painel, DFC, Simples, indicadores) são SÓ de colaborador O2 (imobiliárias veem apenas a própria carteira: parcelas, inadimplência, proposta, apólice, sinistro).
-- As funções erp_nibo_painel (2 e 3 args), erp_nibo_analise, erp_nibo_dfc, erp_nibo_financiamento_contrapartes, erp_nibo_painel_indicadores, erp_nibo_lanc_g e erp_simples_estimativa eram security definer e executáveis por qualquer login.
-- Passaram a security invoker (RLS is_colaborador_o2() das tabelas vale): login que não é da O2 recebe vazio (testado com usuário simulado). Migração "erp_nibo_funcoes_somente_colaborador_o2".
-- Regra para funções novas sobre dado financeiro O2: security invoker, nunca definer sem checar is_colaborador_o2(). Pendente (não é meu): erp_nibo_repasse_conferir() ainda é security definer.

-- 03/11/2026 (11): só Matheus, Nathalie e William veem o Nibo (podeVerNibo, checado no servidor em /erp/nibo). No banco, as 8 funções financeiras (painel 2/3 args, analise, indicadores, dfc, financiamento_contrapartes, lanc_g, simples_estimativa)
-- tiveram EXECUTE revogado de public/anon/authenticated e liberado só para service_role: nem outro colaborador O2 as chama direto pela API. Telas novas devem ler com createServiceClient() DEPOIS de checar podeVerNibo. Migração "erp_nibo_funcoes_so_servidor".
