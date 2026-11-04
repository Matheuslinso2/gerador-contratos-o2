import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

// Regra do Matheus (01/11/2026): qualquer resposta do Robô O2 com dados agregados (cotação, emissão, apólice, proposta,
// endosso, repasse, fatura, campanha, painel...) pode virar PDF em padrão relatório. NÃO geram PDF as respostas com
// documentos de pessoas e empresas (CPF/CNPJ, e-mail, telefone) nem dados pessoais de segurados e inquilinos (nome do
// cliente, cadastro): essas ficam só em texto no chat. A trava é decidida AQUI, no servidor, pelo tipo de consulta
// que o robô fez e por uma checagem do texto final -- não depende do que a IA "acha".

// Tabelas cujas linhas são, por natureza, dados de pessoas (nomes, documentos, contatos de clientes).
const TABELAS_PESSOAIS = new Set([
  "locatarios",
  "erp_planilha_registro", // segurado/locatário/locador e CPF das planilhas
  "producao_itens", // itens dos lotes de RE: nomes e CPF/CNPJ de locador e locatário
  "erp_item_partes",
  "erp_doc_partes_acervo",
  "apolice_partes",
  "erp_clientes_mesclados",
  "erp_contato_cliente_log",
  "campanhas_grupos_contatos",
  "erp_emails",
  "erp_email_ligacoes",
  "sinistros", // locador/locatário/favorecido
  "sinistros_corp", // segurado, e-mail
  "leads_site_o2seguros",
  "erp_parcelas_inadimplencia", // cpf_cnpj do devedor
  "erp_extrato_linhas",
  "erp_corp_comissoes",
]);

// Tabelas de COTAÇÕES (Matheus, 04/11/2026: dados das cotações entram no relatório em PDF). Só deixam de gerar PDF quando a consulta traz a coluna que
// identifica a pessoa (nome do cliente, CPF/CNPJ, título do card, campos livres) ou, nas tabelas que misturam nome, não escolhe colunas (devolveria tudo).
// Agregado (contagem, soma, agrupamento) e listas só com data, produto, seguradora, imobiliária, status, prêmio, comissão e responsável da O2 viram PDF.
const TABELAS_COTACAO = new Set(["producao_resolvida", "cotacoes_cache", "erp_origens", "producao_erp"]);
const COLUNA_PESSOAL_COTACAO = /cpf|cnpj|e?mail|telefone|documento|cliente|segurado|titular|locador|favorecido|nome_pessoa|contato|titulo|dados_legiveis|extras|^locatario$/i;

// Tabelas de empresas com CNPJ/e-mail/telefone: só são pessoais quando essas colunas são pedidas (ou quando nenhuma coluna é escolhida).
const TABELAS_EMPRESA_COM_DOCUMENTO = new Set(["imobiliarias", "imobiliarias_conhecidas", "erp_corretoras", "erp_seguradoras", "relatorios_prospeccao", "faturas_esperadas"]);

const COLUNA_PESSOAL = /cpf|cnpj|e?mail|telefone|documento|cliente|segurado|titular|locatario|locador|favorecido|nome_pessoa|contato/i;

// Partes de painéis que listam pessoas (cards com nome do cliente).
const PARTES_PESSOAIS = new Set([
  "titulos", "negociacoes", "fichas", "cardsQuePedemAtencao", "cardsAlerta", "contratosTardios", "convertidasFinanceiro",
  "alertasOperacionais", "suc_clientes", "camp_clientes", "suc_parados", "crm_leads", "camp_cards", "gestor_cards", "gestor_pares",
  "contatos_vend", "suc_eventos",
]);

export function chamadaTemDadosPessoais(nome: string, entrada: unknown): boolean {
  const e = (entrada ?? {}) as Record<string, unknown>;
  if (nome === "buscar_pessoa" || nome === "buscar_nos_paineis" || nome === "listar_cotacoes_com_pessoa" || nome === "buscar_arquivos_documento" || nome === "ler_corpo_email") return true;
  if (nome === "consultar_dados" || nome === "consultar_tabela") {
    const tabela = String(e.tabela ?? "");
    if (TABELAS_PESSOAIS.has(tabela)) return true;
    const colunas = (Array.isArray(e.colunas) ? e.colunas : []).map(String);
    const agregando = !!e.agrupar_por || (Array.isArray(e.somar) && e.somar.length > 0) || e.apenas_contar === true;
    if (TABELAS_COTACAO.has(tabela)) {
      if (agregando) return false;
      if (tabela === "producao_resolvida") return colunas.some((c) => COLUNA_PESSOAL_COTACAO.test(c));
      return colunas.length === 0 || colunas.some((c) => COLUNA_PESSOAL_COTACAO.test(c));
    }
    if (TABELAS_EMPRESA_COM_DOCUMENTO.has(tabela)) {
      if (agregando) return false;
      return colunas.length === 0 || colunas.some((c) => COLUNA_PESSOAL.test(c));
    }
    return !agregando && colunas.some((c) => COLUNA_PESSOAL.test(c));
  }
  if (nome === "consultar_painel" || nome === "consultar_painel_extra") {
    const partes = (Array.isArray(e.partes) ? e.partes : []).map(String);
    const caminho = String(e.caminho ?? "").split(".")[0];
    return partes.some((p) => PARTES_PESSOAIS.has(p)) || (!!caminho && PARTES_PESSOAIS.has(caminho));
  }
  return false;
}

// Checagem do texto final: documento, e-mail ou telefone no texto = dado pessoal, sem PDF.
export function textoTemDadosPessoais(texto: string): boolean {
  return (
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(texto) ||
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(texto) ||
    /(?<![\d.,])\d{11}(?![\d.,])/.test(texto) ||
    /(?<![\d.,])\d{14}(?![\d.,])/.test(texto) ||
    /[\w.+-]+@[\w-]+\.[\w.-]+/.test(texto) ||
    /\(\d{2}\)\s?\d{4,5}-?\d{4}/.test(texto)
  );
}

// Frase técnica de cada consulta (usada quando a IA não escreveu a lógica do filtro e como "fontes" no rodapé do relatório).
const OPERADORES: Record<string, string> = { eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contem: "contém", in: "em", vazio: "vazio", preenchido: "preenchido" };

export function descreverChamada(nome: string, entrada: unknown): string | null {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? v.map(String).join(", ") : String(v ?? ""));
  if (nome === "buscar_imobiliaria") return `Imobiliária (banco único, inclui o grupo): ${String(e.nome ?? "")}`;
  if (nome === "ler_corpo_email") return "Conteúdo de e-mail ligado à cotação (leitura registrada)";
  if (nome === "contar_documentos_erp") {
    const p: string[] = ["Documentos do ERP"];
    if (e.imobiliaria) p.push(`da imobiliária/grupo ${String(e.imobiliaria)}`);
    if (e.tipo) p.push(`tipo ${lista(e.tipo)}`);
    if (e.situacao) p.push(`situação ${lista(e.situacao)}`);
    if (e.seguradora) p.push(`seguradora ${String(e.seguradora)}`);
    if (e.produto) p.push(`produto ${String(e.produto)}`);
    if (e.vigencia_inicio_de || e.vigencia_inicio_ate) p.push(`início de vigência de ${String(e.vigencia_inicio_de ?? "…")} a ${String(e.vigencia_inicio_ate ?? "…")}`);
    if (e.vigencia_fim_de || e.vigencia_fim_ate) p.push(`fim de vigência de ${String(e.vigencia_fim_de ?? "…")} a ${String(e.vigencia_fim_ate ?? "…")}`);
    if (e.agrupar_por) p.push(`agrupados por ${String(e.agrupar_por)}`);
    return p.join(", ");
  }
  if (nome === "consultar_dados" || nome === "consultar_tabela") {
    const filtros = (Array.isArray(e.filtros) ? e.filtros : []) as { coluna?: string; operador?: string; valor?: unknown }[];
    const f = filtros.map((x) => `${x.coluna} ${OPERADORES[String(x.operador)] ?? x.operador}${x.valor !== undefined ? " " + lista(x.valor) : ""}`).join("; ");
    return `Tabela ${String(e.tabela)}${f ? `, filtros: ${f}` : ""}${e.agrupar_por ? `, agrupado por ${String(e.agrupar_por)}` : ""}${Array.isArray(e.somar) && e.somar.length ? `, somando ${lista(e.somar)}` : ""}`;
  }
  if (nome === "consultar_painel" || nome === "consultar_painel_extra") {
    return `Painel ${String(e.painel)}${e.competencia ? `, competência ${String(e.competencia)}` : ""}${Array.isArray(e.partes) && e.partes.length ? `, partes ${lista(e.partes)}` : ""}${e.caminho ? `, caminho ${String(e.caminho)}` : ""}`;
  }
  if (nome === "gerar_relatorio_pdf") return "Relatório de documentos do ERP";
  if (nome === "consultar_cubo") {
    const filtros = [e.fato, e.produto, e.tipo, e.fonte, e.status, e.seguradora, e.imobiliaria].filter(Boolean).map(String).join(", ") || "todos os dados";
    const periodo = e.mes_de || e.mes_ate ? `, de ${String(e.mes_de ?? "…")} a ${String(e.mes_ate ?? "…")}` : "";
    const agrup = Array.isArray(e.agrupar) && e.agrupar.length ? `, agrupado por ${lista(e.agrupar)}` : "";
    return `Cubo de estatísticas (${filtros}${periodo}${agrup})`;
  }
  if (nome === "consultar_cubo_coberturas" || nome === "consultar_cubo_sinistros") {
    const filtros = [e.produto, e.cobertura, e.seguradora, e.imobiliaria, e.bairro, e.subtipo].filter(Boolean).map(String).join(", ") || "todos os dados";
    const periodo = e.mes_de || e.mes_ate ? `, ocorrência de ${String(e.mes_de ?? "…")} a ${String(e.mes_ate ?? "…")}` : "";
    const coorte = e.mes_apolice_de || e.mes_apolice_ate ? `, apólices iniciadas de ${String(e.mes_apolice_de ?? "…")} a ${String(e.mes_apolice_ate ?? "…")}` : "";
    const agrup = Array.isArray(e.agrupar) && e.agrupar.length ? `, agrupado por ${lista(e.agrupar)}` : "";
    const nomeCubo = nome === "consultar_cubo_sinistros" ? (e.sinistralidade ? "Sinistralidade (indenizado ÷ prêmio das apólices da mesma coorte)" : "Sinistros do Corp") : "Coberturas das apólices do ERP";
    return `${nomeCubo} (${filtros}${periodo}${coorte}${agrup})`;
  }
  if (nome === "consultar_cubo_financeiro" || nome === "consultar_impostos_pagos") {
    const filtros = [e.fato, e.produto, e.ramo, e.status, e.seguradora, e.imobiliaria, e.empresa, e.tipo_imposto].filter(Boolean).map(String).join(", ") || "todos os dados";
    const periodo = e.mes_de || e.mes_ate ? `, de ${String(e.mes_de ?? "…")} a ${String(e.mes_ate ?? "…")}` : "";
    const agrup = Array.isArray(e.agrupar) && e.agrupar.length ? `, agrupado por ${lista(e.agrupar)}` : "";
    return `${nome === "consultar_impostos_pagos" ? "Impostos pagos (Nibo)" : "Receita e repasses (cubo financeiro)"} (${filtros}${periodo}${agrup})`;
  }
  if (nome === "analisar_primeira_cotacao") return `Primeira cotação por imobiliária, de ${String(e.de)} a ${String(e.ate)}${e.produto ? `, produto ${String(e.produto)}` : ""}`;
  return null;
}

export const FERRAMENTA_LOGICA: Anthropic.Tool = {
  name: "registrar_logica_do_filtro",
  description:
    "Registra, para o cabeçalho do relatório em PDF, UMA frase em português descrevendo exatamente o filtro que você aplicou para chegar aos números da resposta. Chame uma vez, junto com as consultas ou logo depois delas, em TODA resposta com dados (contagens, listas, valores). Não precisa em conversa sem dados. Exemplo: \"Propostas emitidas (apólices) pertencentes à imobiliária XPFG, com início de vigência entre 01/01/2026 e 30/06/2026, da seguradora Tokio Marine; fonte: ERP.\" Seja fiel: cite imobiliária/grupo, produto, tipo (cotação, proposta, apólice, endosso...), situação, seguradora, datas e a fonte usada.",
  input_schema: { type: "object", properties: { texto: { type: "string", description: "A frase do filtro." } }, required: ["texto"] },
};
