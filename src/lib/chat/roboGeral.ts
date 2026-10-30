import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { compacto, consultarTabela, type ConfigTabela, type EntradaTabela } from "@/lib/whatsappFerramentas";

// Consulta geral do Robô O2 (29/10/2026, pedido do Matheus: "acesso a tudo dos dois ambientes"). Lista FECHADA de
// tabelas do Workspace e do ERP (abaixo) + colunas descobertas no banco, com bloqueio automático de campo sensível:
// CPF, senha, token, observações do Corp (têm senhas), texto/corpo de e-mail, dados bancários de terceiros,
// telefone de pessoa, colunas JSON. Ficam FORA conversas (chat, WhatsApp, e-mails), cofre de locatários, partes de
// apólice (CPF), contratos, tokens/credenciais e backups. Somente leitura.

const TABELAS_DESCRICAO: Record<string, string> = {
  // --- ERP O2
  erp_documentos: "Documentos do ERP (apólices, endossos, faturas, propostas). tipo A=Apólice, C/D/I/M/R/X=endossos, F=Fatura. situacao: cotacao, proposta, vigente, vencido, cancelado, duplicado. imobiliaria_principal_id liga à ficha da imobiliária. Para apólices use situacao vigente/vencido/cancelado e tipo A.",
  erp_documento_produtores: "Produtores/imobiliárias de cada documento, com participação e repasse (repasse_pct/valor).",
  erp_imobiliarias_resumo: "Resumo pronto por imobiliária: docs_total, docs_vigentes (todo tipo), premio_vigente, comissao_vigente, propostas_pendentes (em Emissão), faturas.",
  erp_parcelas: "Parcelas dos documentos (vencimento, valor, situação).",
  erp_parcelas_inadimplencia: "Parcelas em atraso/inadimplência.",
  erp_comissoes: "Comissão por documento/parcela prevista e recebida.",
  erp_comissao_recebimentos: "Recebimentos de comissão (baixas).",
  erp_comissao_regras: "Regras de comissão por seguradora/produto.",
  erp_corp_comissoes: "Comissões lidas do Corp (previsto x recebido) por parcela.",
  erp_extratos_seguradora: "Extratos de pagamento das seguradoras (cabeçalho).",
  erp_extrato_linhas: "Linhas dos extratos das seguradoras (cada comissão paga).",
  erp_baixa_erp: "Baixas de comissão feitas no ERP.",
  erp_faturas: "Faturas das seguradoras por imobiliária.",
  erp_fatura_itens: "Itens (apólices) de cada fatura.",
  erp_fatura_meses: "Faturas por mês.",
  erp_repasses: "Repasses de comissão às imobiliárias (ERP).",
  erp_repasse_lotes: "Lotes de repasse.",
  erp_repasse_regras: "Regras de repasse por imobiliária.",
  erp_repasse_ajustes: "Ajustes manuais de repasse.",
  erp_renovacoes: "Renovações (vigências que vencem e renovação ligada).",
  erp_renovacao_negociacao: "Negociação das renovações.",
  erp_seguradoras: "Cadastro de seguradoras do ERP.",
  erp_ramos: "Cadastro de ramos/produtos (campo produto: fianca, incendio, capitalizacao...).",
  erp_corretoras: "Corretoras (O2 e outras).",
  erp_canais: "Canais de venda.",
  erp_clientes_resumo: "Resumo por cliente (sem CPF).",
  erp_emissao_fila_pronta: "Fila de Emissão: propostas efetivadas ainda sem documento oficial (pendência).",
  erp_emissao_kpis_pronta: "KPIs prontos da tela Emissão.",
  erp_inicio_kpis_pronta: "KPIs prontos da tela Início do ERP.",
  erp_vencimentos_pronto: "Vencimentos prontos.",
  erp_alertas_fatura_pronto: "Alertas de fatura.",
  erp_conferencia_corp_pronto: "Conferência Corp x ERP.",
  erp_retrato_mensal: "Retrato mensal congelado do ERP.",
  erp_saldo_cobrar_seguradora: "Saldo a cobrar das seguradoras.",
  erp_nibo_contas: "Contas do Nibo (somente leitura).",
  erp_nibo_lancamentos: "Lançamentos financeiros do Nibo (somente leitura).",
  erp_documento_itens: "Itens (bens segurados) de cada documento.",
  erp_documento_coberturas: "Coberturas do documento.",
  erp_documento_eventos: "Linha do tempo do documento.",
  erp_gestao_baixas_notas: "Notas da Gestão das baixas.",
  erp_descontos_comissao: "Descontos aplicados à comissão.",
  erp_descontos_recorrentes: "Descontos recorrentes de comissão.",
  erp_estornos_endosso_pronto: "Estornos por endosso.",
  erp_prazos_comissao: "Prazos de pagamento de comissão por seguradora.",
  erp_formas_pagamento: "Formas de pagamento.",
  erp_origens: "Origem dos documentos (card do Bitrix, Corp...).",
  // --- Imobiliárias (banco único)
  imobiliarias: "Ficha única das imobiliárias (banco unificado). grupo_id liga ao grupo.",
  imobiliaria_grupos: "Grupos de imobiliárias (ex.: Ramiro Sá).",
  imobiliaria_registros_fonte: "Nomes/códigos vindos de cada fonte (Bitrix, Corp, planilhas) e vínculo com a ficha.",
  imobiliaria_historico: "Histórico de alterações das fichas.",
  imobiliarias_conhecidas: "Nomes de imobiliárias conhecidos.",
  imobiliarias_metricas: "Histórico por imobiliária: incêndio/fiança/renovação realizadas e convertidas.",
  // --- Campanhas e comercial
  campanhas: "Campanhas comerciais (assunto, status, produto, datas, total enviados).",
  campanhas_envios: "Cada e-mail de campanha por imobiliária: enviado, aberto, clicado.",
  campanhas_grupos: "Grupos de destinatários de campanha.",
  campanhas_metas: "Metas por imobiliária dentro da campanha (meta, custo de premiação, responsável).",
  campanhas_producao: "Produção da imobiliária dentro da campanha (apólices, prêmio, comissão, repasse).",
  painel_comercial_metas_campanha: "Metas das campanhas no Painel Comercial.",
  avisos_internos_envios: "Avisos internos enviados.",
  relatorios_prospeccao: "Fichas de prospecção de novas imobiliárias.",
  leads_site_o2seguros: "Leads dos formulários do site (sem telefone).",
  // --- Produção / Corp
  producao_resolvida: "COTAÇÕES (e histórico de produção) por imobiliária, já ligadas ao banco único (view de producao_unificada com imobiliaria_id, grupo_id e imobiliaria_exibicao). É onde estão os CARDS DO BITRIX copiados (fonte='bitrix', atualizados de hora em hora) e as planilhas antigas (fonte='planilha') e o Corp (fonte='corp', apólices efetivadas). produto: fianca, re (ramos elementares: incêndio/imobiliário, residencial etc.), capitalizacao, automovel. status_padrao: 'Em análise' = cotação EM ABERTO; 'Aprovado' (Fiança) = cotação aprovada ainda não efetivada (também aberta); 'Convertido' = cotação efetivada; 'Perdido' e 'Recusado' = encerradas sem negócio; 'Efetivado' (corp) = apólice. Para cotações em aberto de uma imobiliária: filtre imobiliaria_id (in, com todos os ids do grupo de buscar_imobiliaria) e status_padrao, agrupando por produto e fonte.",
  producao_unificada: "Linha única de produção por origem (cotações de planilhas e Bitrix, apólices do Corp) com produto, status padrão, prêmio e comissão. imobiliaria_texto = nome da imobiliária na fonte.",
  producao_erp: "Produção do Corp (apólices/endossos emitidos) com prêmio e comissão.",
  producao_resumo_mensal: "Produção do Corp somada por ramo e mês.",
  producao_resumo_seguradora: "Produção do Corp somada por seguradora.",
  producao_resumo_produtor: "Produção do Corp somada por produtor.",
  producao_resumo_bairro: "Produção por bairro.",
  corp_meta_comissao: "Metas de comissão do Corp.",
  corp_producao_corretora: "Produção do Corp por corretora (view).",
  corp_producao_produtor: "Produção do Corp por produtor (view).",
  corp_retrato_producao_dim: "Retrato de produção do Corp por mês e dimensões (view).",
  corp_retrato_sinistros_dim: "Retrato de sinistros do Corp (view).",
  cotacoes_cache: "Cotações lidas das planilhas (Ramos Elementares): imobiliária, prêmio, status.",
  // --- Faturas / repasses (Workspace)
  faturas: "Faturas recebidas das seguradoras para repassar às imobiliárias.",
  faturas_envios: "Envios de faturas às imobiliárias.",
  faturas_esperadas: "Faturas esperadas por imobiliária e seguradora.",
  repasses: "Repasses de comissão enviados às imobiliárias (Workspace).",
  repasses_envios: "Envios de comprovantes de repasse.",
  // --- Sinistros
  sinistros: "Sinistros abertos pelas imobiliárias/equipe (etapa, desfecho, valores avisados).",
  sinistros_corp: "Sinistros importados do Corp (todo sinistro conta, inclusive resgate de capitalização).",
  sinistro_historico: "Histórico de cada sinistro.",
  sinistro_debitos: "Débitos do sinistro.",
  sinistro_indenizacoes: "Indenizações do sinistro.",
  sinistros_equipe: "Equipe responsável por sinistros.",
  sinistros_kpi_fato: "Fato de KPIs de sinistros por mês.",
  sinistros_kpi_grupos: "Grupos de KPIs de sinistros.",
  // --- Outros do Workspace
  auditorias_contrato: "Contratos de locação analisados pelo Auditor.",
  assistente_fianca_analises: "Uso do Assistente de Vendas Fiança.",
  incendio_emails_confirmacao: "Confirmações de seguro incêndio recebidas das seguradoras.",
  panoramas_fianca: "Panoramas de preços de Fiança.",
  panoramas_fianca_envios: "Envios dos panoramas de Fiança.",
  estatisticas_ticket: "Ticket médio de aluguel.",
  workspace_acessos_diarios: "Quem usou o Workspace por dia.",
  social_media_posts: "Posts de redes sociais.",
  seguradoras: "Cadastro de seguradoras do Workspace.",
  produtos: "Produtos.",
  tipos_garantia: "Tipos de garantia locatícia.",
};

const COLUNA_SENSIVEL = /cpf|senha|password|token|secret|api_?key|corpo|html|nascimento|observa|(^|_)documento$|favorecido_(banco|agencia|conta)|telefone|ciencia_texto|(^|_)nota(s)?$|(^|_)texto$|parcela_texto/i;
const COLUNA_PERMITIDA_APESAR = new Set(["imobiliaria_texto"]);
const TIPOS_BLOQUEADOS = new Set(["jsonb", "json", "bytea"]);
// Quem não é admin não vê comissão, repasse, saldo, imposto, desconto, premiação.
const COLUNA_FINANCEIRA = /comiss|repasse|premiacao|pro_?labore|saldo|imposto|desconto/i;
const TABELA_FINANCEIRA = /^(erp_(repasse|baixa|comissao|comissoes|corp_comissoes|nibo|extrato|saldo|previsao|imposto|desconto|descontos|estorno|gestao)|repasses|producao_(?!unificada|resolvida)|corp_|campanhas_producao|campanhas_metas|faturas|erp_fatura)/i;

let cacheColunas: { em: number; mapa: Map<string, { coluna: string; tipo: string }[]> } | null = null;

async function colunasDoBanco() {
  if (cacheColunas && Date.now() - cacheColunas.em < 10 * 60_000) return cacheColunas.mapa;
  // O PostgREST devolve no máximo 1000 linhas por chamada: pagina até acabar.
  const linhas: { tabela: string; coluna: string; tipo: string }[] = [];
  for (let de = 0; de < 20000; de += 1000) {
    const { data, error } = await createServiceClient().rpc("chat_robo_colunas").range(de, de + 999);
    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as { tabela: string; coluna: string; tipo: string }[]));
    if (!data || data.length < 1000) break;
  }
  const mapa = new Map<string, { coluna: string; tipo: string }[]>();
  for (const r of linhas) {
    const l = mapa.get(r.tabela) ?? [];
    l.push({ coluna: r.coluna, tipo: r.tipo });
    mapa.set(r.tabela, l);
  }
  cacheColunas = { em: Date.now(), mapa };
  return mapa;
}

async function tabelasPermitidas(verComissao: boolean): Promise<Record<string, ConfigTabela>> {
  const mapa = await colunasDoBanco();
  const saida: Record<string, ConfigTabela> = {};
  for (const [nome, descricao] of Object.entries(TABELAS_DESCRICAO)) {
    const cols = mapa.get(nome);
    if (!cols) continue;
    if (!verComissao && TABELA_FINANCEIRA.test(nome)) continue;
    const colunas = cols
      .filter((c) => !TIPOS_BLOQUEADOS.has(c.tipo))
      .filter((c) => COLUNA_PERMITIDA_APESAR.has(c.coluna) || !COLUNA_SENSIVEL.test(c.coluna))
      .filter((c) => verComissao || !COLUNA_FINANCEIRA.test(c.coluna))
      .map((c) => c.coluna);
    if (colunas.length) saida[nome] = { descricao, colunas };
  }
  return saida;
}

const PAINEIS_EXTRA: Record<string, string> = {
  painel_comercial: "Painel Comercial v5 (funis Ativação de Novos Clientes e Sucesso do Cliente, metas das campanhas, por responsável). Último retrato; com 'competencia' (YYYY-MM) devolve o mês fechado.",
  sinistros: "KPIs de sinistros (retrato atual do módulo Sinistros).",
  endosso_fianca: "Painel de Endossos de Fiança, por competência (YYYY-MM).",
  corp: "Painéis prontos do Corp (produção/sinistros). Sem 'chave' lista as chaves disponíveis.",
};

export const FERRAMENTAS_GERAIS: Anthropic.Tool[] = [
  {
    name: "descrever_tabelas",
    description:
      "Lista as tabelas do Workspace e do ERP que você pode consultar, com a descrição de cada uma. Com 'tabela', devolve as colunas liberadas daquela tabela (peça antes de consultar uma tabela que você não conhece).",
    input_schema: { type: "object", properties: { tabela: { type: "string" } } },
  },
  {
    name: "consultar_dados",
    description:
      "Consulta somente leitura qualquer tabela do Workspace ou do ERP (use descrever_tabelas para ver as tabelas e colunas). Aceita filtros (eq, neq, gt, gte, lt, lte, contem, in, vazio, preenchido), ordenação, contagem (apenas_contar) e soma/agrupamento (agrupar_por + somar). Linhas com imobiliaria_id ganham o nome da imobiliária. Para uma imobiliária, filtre por imobiliaria_id (pegue o id com buscar_imobiliaria).",
    input_schema: {
      type: "object",
      properties: {
        tabela: { type: "string", enum: Object.keys(TABELAS_DESCRICAO) },
        colunas: { type: "array", items: { type: "string" } },
        filtros: {
          type: "array",
          items: {
            type: "object",
            properties: {
              coluna: { type: "string" },
              operador: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contem", "in", "vazio", "preenchido"] },
              valor: {},
            },
            required: ["coluna", "operador"],
          },
        },
        ordenar_por: { type: "string" },
        decrescente: { type: "boolean" },
        limite: { type: "integer" },
        apenas_contar: { type: "boolean" },
        agrupar_por: { type: "string" },
        somar: { type: "array", items: { type: "string" } },
      },
      required: ["tabela"],
    },
  },
  {
    name: "consultar_painel_extra",
    description:
      "Lê retratos de painéis que não estão em consultar_painel:\n" +
      Object.entries(PAINEIS_EXTRA).map(([k, v]) => `- ${k}: ${v}`).join("\n") +
      "\nSem 'partes', devolve as chaves disponíveis do retrato; peça só as partes necessárias.",
    input_schema: {
      type: "object",
      properties: {
        painel: { type: "string", enum: Object.keys(PAINEIS_EXTRA) },
        competencia: { type: "string", description: "YYYY-MM (painel_comercial e endosso_fianca)." },
        chave: { type: "string", description: "Só para painel 'corp'." },
        partes: { type: "array", items: { type: "string" } },
      },
      required: ["painel"],
    },
  },
];

function recortar(payload: unknown, partes?: string[]) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { dados: payload };
  const obj = payload as Record<string, unknown>;
  const escolhidas = partes?.filter((k) => k in obj);
  return {
    partesDisponiveis: Object.keys(obj),
    ...(partes?.length ? { dados: Object.fromEntries((escolhidas ?? []).map((k) => [k, obj[k]])) } : {}),
    ...(partes?.some((k) => !(k in obj)) ? { partesInexistentes: partes.filter((k) => !(k in obj)) } : {}),
  };
}

async function consultarPainelExtra(e: { painel: string; competencia?: string; chave?: string; partes?: string[] }): Promise<string> {
  const sb = createServiceClient();
  if (e.painel === "painel_comercial") {
    if (e.competencia) {
      const { data } = await sb.from("painel_comercial_meses_fechados").select("mes, kpi, congelado_em").eq("mes", e.competencia).maybeSingle();
      if (data) return compacto({ painel: e.painel, competencia: e.competencia, congeladoEm: data.congelado_em, ...recortar(data.kpi, e.partes) });
    }
    const { data } = await sb.from("painel_comercial_snapshot").select("gerado_em, dados").order("id", { ascending: false }).limit(1).maybeSingle();
    if (!data) return "Não há retrato do Painel Comercial.";
    return compacto({ painel: e.painel, geradoEm: data.gerado_em, ...(e.competencia ? { observacao: `Mês ${e.competencia} não está fechado; este é o retrato atual.` } : {}), ...recortar(data.dados, e.partes) });
  }
  if (e.painel === "sinistros") {
    const { data } = await sb.from("sinistros_kpis_retrato").select("atualizado_em, dados").limit(1).maybeSingle();
    if (!data) return "Não há retrato de sinistros.";
    return compacto({ painel: e.painel, atualizadoEm: data.atualizado_em, ...recortar(data.dados, e.partes) });
  }
  if (e.painel === "endosso_fianca") {
    if (!e.competencia) return "Informe a competência (YYYY-MM).";
    const { data } = await sb.from("seguro_fianca_endosso_snapshots").select("atualizado_em, payload").eq("competencia", e.competencia).maybeSingle();
    if (!data) return `Não há retrato de endossos de Fiança em ${e.competencia}.`;
    return compacto({ painel: e.painel, competencia: e.competencia, atualizadoEm: data.atualizado_em, ...recortar(data.payload, e.partes) });
  }
  if (e.painel === "corp") {
    if (!e.chave) {
      const { data } = await sb.from("corp_painel_pronto").select("chave, gerado_em").limit(200);
      return compacto({ painel: e.painel, chavesDisponiveis: data ?? [] });
    }
    const { data } = await sb.from("corp_painel_pronto").select("gerado_em, dados").eq("chave", e.chave).maybeSingle();
    if (!data) return `Não há painel do Corp com a chave ${e.chave}.`;
    return compacto({ painel: e.painel, chave: e.chave, geradoEm: data.gerado_em, ...recortar(data.dados, e.partes) });
  }
  return `Painel desconhecido. Use: ${Object.keys(PAINEIS_EXTRA).join(", ")}`;
}

export async function executarFerramentaGeral(nome: string, entrada: unknown, verComissao: boolean): Promise<string | null> {
  try {
    if (nome === "descrever_tabelas") {
      const tabelas = await tabelasPermitidas(verComissao);
      const alvo = (entrada as { tabela?: string }).tabela;
      if (alvo) return tabelas[alvo] ? JSON.stringify({ tabela: alvo, ...tabelas[alvo] }) : `Tabela não disponível. Use: ${Object.keys(tabelas).join(", ")}`;
      // Sem colunas (a lista inteira estouraria o limite); peça uma tabela para ver as colunas.
      return JSON.stringify(Object.entries(tabelas).map(([t, c]) => ({ tabela: t, descricao: c.descricao })));
    }
    if (nome === "consultar_dados") return await consultarTabela(entrada as EntradaTabela, await tabelasPermitidas(verComissao));
    if (nome === "consultar_painel_extra") {
      if (!verComissao) return "Painéis completos só estão liberados para administradores.";
      return await consultarPainelExtra(entrada as Parameters<typeof consultarPainelExtra>[0]);
    }
    return null;
  } catch (err) {
    return `Erro ao consultar: ${err instanceof Error ? err.message : String(err)}`;
  }
}
