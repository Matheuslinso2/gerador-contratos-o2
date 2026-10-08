import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

// Ferramentas da IA do WhatsApp (Fase 2, 07/10/2026 -- "praticamente todo o
// Workspace", pedido do Matheus). A IA escolhe o que consultar conforme a
// pergunta. Tudo lê SÓ o Supabase (retratos dos painéis + tabelas do
// Workspace) -- nunca o Bitrix (regra do Matheus). Lista FECHADA de tabelas
// e colunas: dado sensível (CPF/CNPJ de cliente, texto de contrato, corpo
// de e-mail, senha de PDF, texto extraído de documento) não entra.

const LIMITE_LINHAS = 50;
const LIMITE_AGREGACAO = 30000; // linhas lidas pra somar/agrupar
const LIMITE_CARACTERES = 18000; // por resultado de ferramenta

type ConfigTabela = { descricao: string; colunas: string[] };

const TABELAS: Record<string, ConfigTabela> = {
  imobiliarias: {
    descricao: "Cadastro das imobiliárias parceiras (clientes da O2).",
    colunas: ["id", "nome", "apelido", "cnpj", "cidade", "uf", "bairro", "quantidade_imoveis", "classificacao_crm", "responsavel_crm", "responsavel", "codigo_produtor_corp", "telefone", "email", "autorizado", "cadastro_incompleto", "created_at"],
  },
  imobiliarias_metricas: {
    descricao: "Histórico por imobiliária: incêndio/fiança/renovação realizadas, convertidas e prêmio convertido.",
    colunas: ["nome_exemplo", "incendio_realizadas", "incendio_convertidas", "incendio_premio_convertido", "fianca_realizadas", "fianca_convertidas", "fianca_premio_convertido", "renovacao_realizadas", "renovacao_convertidas", "renovacao_premio_convertido", "calculado_em"],
  },
  producao_erp: {
    descricao: "Produção do Corp (ERP): cada apólice/endosso emitido, com prêmio e comissão. competencia = 'YYYY-MM'. ~18 mil linhas -- para totais use agrupar_por/somar. A base é importada manualmente do Corp e pode não ter os meses mais recentes.",
    colunas: ["ramo", "seguradora", "produtor", "numero_apolice", "cliente_nome", "inicio_vigencia", "fim_vigencia", "competencia", "parcelas", "premio_liquido", "premio_total", "valor_comissao", "percentual_comissao", "valor_comissao_produtor", "tipo", "canal_vendas"],
  },
  producao_resumo_mensal: { descricao: "Produção do Corp já somada por ramo, competência e tipo.", colunas: ["ramo", "competencia", "tipo", "quantidade", "premio_total", "comissao_corretora"] },
  producao_resumo_seguradora: { descricao: "Produção do Corp somada por seguradora e ramo (histórico todo).", colunas: ["seguradora", "ramo", "quantidade", "premio_total", "comissao_corretora"] },
  producao_resumo_produtor: { descricao: "Produção do Corp somada por produtor (imobiliária/corretor) e ramo.", colunas: ["produtor", "ramo", "quantidade", "premio_total", "comissao_corretora", "comissao_produtor"] },
  producao_resumo_bairro: { descricao: "Produção do Corp somada por bairro/cidade e ramo.", colunas: ["ramo", "bairro", "cidade", "uf", "quantidade", "premio_total", "comissao_soma", "aluguel_soma", "aluguel_quantidade"] },
  producao_resumo_clientes_ramo: { descricao: "Clientes distintos por ramo.", colunas: ["ramo", "clientes_distintos"] },
  producao_resumo_cross_sell: { descricao: "Clientes do imobiliário que também têm auto.", colunas: ["total_clientes_imobiliario", "clientes_imobiliario_com_auto"] },
  faturas: {
    descricao: "Faturas (boletos de seguro) recebidas das seguradoras para repassar às imobiliárias. competencia = 'YYYY-MM'.",
    colunas: ["competencia", "imobiliaria_id", "seguradora", "vencimento", "valor", "status", "tipo_documento", "origem", "created_at"],
  },
  faturas_envios: { descricao: "Envios de faturas por e-mail às imobiliárias.", colunas: ["imobiliaria_id", "competencia", "seguradora", "envio_parcial", "resultado", "enviado_por_email", "created_at"] },
  faturas_esperadas: { descricao: "Faturas que cada imobiliária deve receber todo mês (por seguradora).", colunas: ["imobiliaria_id", "seguradora", "ativo", "dia_vencimento", "nome_provisorio"] },
  repasses: {
    descricao: "Repasses de comissão da O2 para as imobiliárias. competencia = 'YYYY-MM'.",
    colunas: ["competencia", "imobiliaria_id", "nome_provisorio", "valor", "data_pagamento", "status", "tipo_documento", "created_at"],
  },
  repasses_envios: { descricao: "Envios de comprovantes de repasse às imobiliárias.", colunas: ["imobiliaria_id", "competencia", "resultado", "created_at"] },
  campanhas: {
    descricao: "Campanhas comerciais de e-mail para imobiliárias.",
    colunas: ["id", "nome", "assunto", "status", "produto", "produtos", "total_destinatarios", "total_enviados", "total_falhas", "agendado_para", "disparada_em", "concluida_em", "criado_por_email", "created_at"],
  },
  campanhas_envios: { descricao: "Cada e-mail de campanha: entregue, aberto, clicado.", colunas: ["campanha_id", "imobiliaria_id", "status", "enviado_em", "aberto_em", "clicado_em"] },
  leads_site_o2seguros: {
    descricao: "Leads dos formulários do site o2seguros.com.br.",
    colunas: ["formulario", "nome", "email", "telefone", "criado_em", "utm_source", "utm_campaign", "status_interno", "bitrix_status", "primeiro_contato_em"],
  },
  auditorias_contrato: { descricao: "Contratos de locação analisados pelo Auditor de Contrato.", colunas: ["imobiliaria_id", "nome_arquivo", "status_geral", "tipo_garantia_identificada", "created_at"] },
  assistente_fianca_analises: { descricao: "Uso do Assistente de Vendas Fiança (análises feitas pela equipe).", colunas: ["criado_por", "entrada_tipo", "feedback_precisao", "feedback_utilidade", "created_at"] },
  incendio_emails_confirmacao: {
    descricao: "E-mails de confirmação de seguro incêndio recebidos das seguradoras (contratação, apólice emitida, cancelamento).",
    colunas: ["recebido_em", "tipo_confirmacao", "seguradora", "cliente_nome", "ramo", "valor", "divergencia", "divergencia_tipo"],
  },
  relatorios_prospeccao: {
    descricao: "Fichas de prospecção de novas imobiliárias e o resultado da abordagem.",
    colunas: ["nome_imobiliaria", "criado_por_email", "created_at", "resultado_temperatura", "resultado_estagio", "resultado_proximo_passo", "resultado_data_proximo_passo", "crm_classificacao", "crm_responsavel", "quantidade_imoveis", "potencial_bruto_mensal"],
  },
  estatisticas_ticket: { descricao: "Ticket médio de aluguel por cidade/tipo/faixa.", colunas: ["nivel", "chave", "cidade", "tipo", "faixa", "ticket_medio", "quantidade"] },
  workspace_acessos_diarios: { descricao: "Quem usou o Workspace em cada dia.", colunas: ["email", "dia", "qtd_requisicoes"] },
};

const PAINEIS: Record<string, { tabela: string; descricao: string }> = {
  seguro_fianca: {
    tabela: "seguro_fianca_snapshots",
    descricao:
      "kpis (total, emAndamento, recusados, aprovados, perdidos, convertidos, comAlerta, imobiliarias), porFunilEtapa, porResponsavelFunil1/2, statusPorSeguradora, cotadoPorSeguradora, convertidoPorSeguradora (n, premio, comissao), taxaPorSeguradora, topImobiliarias (por imobiliária: total, recusados, emAndamento, perdidos, convertidos, premioEfetivado, comissaoEfetivada, taxas, clienteNovo), motivosPerdaFunil2, motivosRecusaFunil1, tempoPorEtapa, tempoPorFunil, cardsQuePedemAtencao, contratosTardios, valoresTrabalhados, faixasPacoteLocacao, analisesDiariasPorResponsavel, contratosRecebidosPorDia, efetivacoesPorDia, qualidade",
  },
  renovacao_fianca: {
    tabela: "seguro_fianca_renovacao_snapshots",
    descricao: "kpis (total, novos, herdados, emAndamento, renovados, perdidos, taxaRenovacao), porEtapa, reajuste, financeiro, seguradoras, imobiliarias, porVencimento, imobiliariasPorVencimento, perdasPorMotivo, equipe, tempoPorEtapa, controleDiario",
  },
  capitalizacao: {
    tabela: "capitalizacao_snapshots",
    descricao: "kpis (total, emitidos, perdidos, emAndamento, taxaConversao, valorTotalEmitido, comissaoEfetivada, comissaoPotencial, cardsComAlerta, numeroImobiliarias, ticketMedioPremio), funil, cardsAlerta, titulos (titular, imobiliaria, etapa, valor, comissao), porDia",
  },
  seguro_auto: {
    tabela: "seguro_auto_snapshots",
    descricao: "kpis (total, convertidos, perdidos, emAndamento, taxaConversao, premioEfetivado, comissaoGerada), funil, cardsAlerta, convertidasFinanceiro, fichas, distribuicaoUtilizacao, distribuicaoGaragem, porDia",
  },
  ramos_elementares: {
    tabela: "ramos_elementares_snapshots",
    descricao: "visaoGeral, novos (consolidado/mes/pendentes: total, efetivados, conversao, premio, comissao, porStatus, porRamo, porCotador, porImobiliaria, porSeguradora), renovacoes (atual/futura, mesma forma), financeiro, endossos, alertasOperacionais, qualidade, negociacoes",
  },
  comercial: {
    tabela: "comercial_kpis_snapshots",
    descricao: "Funis comerciais do Bitrix (Ativação de Novos Clientes e Sucesso do Cliente): sucesso, ativacao, porResponsavel, qualidade, totalEventos",
  },
};

export const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: "consultar_painel",
    description:
      "Lê o retrato salvo de um painel do Workspace numa competência (mês). Use para perguntas sobre Seguro Fiança, Renovação de Fiança, Capitalização, Seguro Auto, Ramos Elementares (incêndio etc.) e funis comerciais: por imobiliária, por seguradora, por responsável, cards parados, motivos de perda, tempos, renovações. Sem 'partes', devolve os kpis e a lista de partes disponíveis; peça só as partes necessárias.\n\nPartes por painel:\n" +
      Object.entries(PAINEIS)
        .map(([nome, p]) => `- ${nome}: ${p.descricao}`)
        .join("\n"),
    input_schema: {
      type: "object",
      properties: {
        painel: { type: "string", enum: Object.keys(PAINEIS) },
        competencia: { type: "string", description: "Mês no formato YYYY-MM." },
        partes: { type: "array", items: { type: "string" }, description: "Chaves do retrato a devolver (ex: [\"topImobiliarias\"])." },
      },
      required: ["painel", "competencia"],
    },
  },
  {
    name: "consultar_tabela",
    description:
      "Consulta uma tabela do Workspace (somente leitura). Pode filtrar, ordenar, contar, ou somar/agrupar (agrupar_por + somar) para totais. Linhas com imobiliaria_id ganham o nome da imobiliária. Tabelas e colunas permitidas:\n" +
      Object.entries(TABELAS)
        .map(([nome, t]) => `- ${nome}: ${t.descricao} Colunas: ${t.colunas.join(", ")}`)
        .join("\n"),
    input_schema: {
      type: "object",
      properties: {
        tabela: { type: "string", enum: Object.keys(TABELAS) },
        colunas: { type: "array", items: { type: "string" }, description: "Colunas a devolver (padrão: todas as permitidas)." },
        filtros: {
          type: "array",
          items: {
            type: "object",
            properties: {
              coluna: { type: "string" },
              operador: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contem", "in", "vazio", "preenchido"] },
              valor: { description: "Valor do filtro (lista para 'in'; texto parcial para 'contem', sem diferenciar maiúsculas)." },
            },
            required: ["coluna", "operador"],
          },
        },
        ordenar_por: { type: "string" },
        decrescente: { type: "boolean" },
        limite: { type: "integer", description: `Máximo de linhas (até ${LIMITE_LINHAS}).` },
        apenas_contar: { type: "boolean", description: "Só devolve a quantidade de linhas que batem com os filtros." },
        agrupar_por: { type: "string", description: "Coluna para agrupar (opcional, junto com 'somar')." },
        somar: { type: "array", items: { type: "string" }, description: "Colunas numéricas para somar (total geral, ou por grupo se houver agrupar_por)." },
      },
      required: ["tabela"],
    },
  },
];

type Filtro = { coluna: string; operador: string; valor?: unknown };
type EntradaTabela = {
  tabela: string;
  colunas?: string[];
  filtros?: Filtro[];
  ordenar_por?: string;
  decrescente?: boolean;
  limite?: number;
  apenas_contar?: boolean;
  agrupar_por?: string;
  somar?: string[];
};

function compacto(valor: unknown): string {
  // Listas longas viram as primeiras 40 + aviso, pra caber no contexto.
  const podado = JSON.parse(
    JSON.stringify(valor, (_k, v) =>
      Array.isArray(v) && v.length > 40 ? [...v.slice(0, 40), `… +${v.length - 40} itens não mostrados`] : v
    )
  );
  const texto = JSON.stringify(podado);
  return texto.length > LIMITE_CARACTERES ? texto.slice(0, LIMITE_CARACTERES) + "… [cortado -- peça partes/filtros mais específicos]" : texto;
}

async function consultarPainel(entrada: { painel: string; competencia: string; partes?: string[] }): Promise<string> {
  const painel = PAINEIS[entrada.painel];
  if (!painel) return `Painel desconhecido. Use: ${Object.keys(PAINEIS).join(", ")}`;
  const { data, error } = await createServiceClient()
    .from(painel.tabela)
    .select("atualizado_em, payload")
    .eq("competencia", entrada.competencia)
    .maybeSingle();
  if (error) return `Erro ao ler o painel: ${error.message}`;
  if (!data) return `Não há retrato salvo do painel ${entrada.painel} em ${entrada.competencia}.`;
  const payload = data.payload as Record<string, unknown>;
  const partes = entrada.partes?.length ? entrada.partes : ["kpis", "visaoGeral", "financeiro"].filter((k) => k in payload);
  const escolhido = Object.fromEntries(partes.filter((k) => k in payload).map((k) => [k, payload[k]]));
  return compacto({
    painel: entrada.painel,
    competencia: entrada.competencia,
    atualizadoEm: data.atualizado_em,
    partesDisponiveis: Object.keys(payload),
    ...(entrada.partes?.some((k) => !(k in payload)) ? { partesInexistentes: entrada.partes.filter((k) => !(k in payload)) } : {}),
    dados: escolhido,
  });
}

// Troca imobiliaria_id pelo nome nas linhas (a IA não tem como resolver uuid).
async function comNomeImobiliaria(linhas: Record<string, unknown>[]) {
  const ids = [...new Set(linhas.map((l) => l.imobiliaria_id).filter((v): v is string => typeof v === "string"))];
  if (!ids.length) return linhas;
  const { data } = await createServiceClient().from("imobiliarias").select("id, nome").in("id", ids);
  const nomes = new Map((data ?? []).map((i) => [i.id as string, i.nome as string]));
  return linhas.map(({ imobiliaria_id, ...resto }) => ({
    imobiliaria: typeof imobiliaria_id === "string" ? (nomes.get(imobiliaria_id) ?? imobiliaria_id) : null,
    ...resto,
  }));
}

async function consultarTabela(e: EntradaTabela): Promise<string> {
  const config = TABELAS[e.tabela];
  if (!config) return `Tabela não permitida. Use: ${Object.keys(TABELAS).join(", ")}`;
  const permitida = (c: string) => config.colunas.includes(c);
  const usadas = [...(e.colunas ?? []), ...(e.filtros ?? []).map((f) => f.coluna), e.ordenar_por, e.agrupar_por, ...(e.somar ?? [])].filter(
    (c): c is string => !!c
  );
  const proibidas = usadas.filter((c) => !permitida(c));
  if (proibidas.length) return `Colunas não permitidas em ${e.tabela}: ${proibidas.join(", ")}. Permitidas: ${config.colunas.join(", ")}`;

  const agregando = !!e.somar?.length || !!e.agrupar_por;
  const colunas = agregando
    ? [...new Set([e.agrupar_por, ...(e.somar ?? [])].filter((c): c is string => !!c))]
    : e.colunas?.length
      ? e.colunas
      : config.colunas;

  const montar = (de: number, ate: number, contar = false) => {
    let q = createServiceClient()
      .from(e.tabela)
      .select(colunas.join(","), contar ? { count: "exact", head: true } : undefined);
    for (const f of e.filtros ?? []) {
      const v = f.valor;
      switch (f.operador) {
        case "eq": q = q.eq(f.coluna, v as never); break;
        case "neq": q = q.neq(f.coluna, v as never); break;
        case "gt": q = q.gt(f.coluna, v as never); break;
        case "gte": q = q.gte(f.coluna, v as never); break;
        case "lt": q = q.lt(f.coluna, v as never); break;
        case "lte": q = q.lte(f.coluna, v as never); break;
        case "contem": q = q.ilike(f.coluna, `%${String(v ?? "")}%`); break;
        case "in": q = q.in(f.coluna, (Array.isArray(v) ? v : [v]) as never[]); break;
        case "vazio": q = q.is(f.coluna, null); break;
        case "preenchido": q = q.not(f.coluna, "is", null); break;
      }
    }
    if (e.ordenar_por && !contar) q = q.order(e.ordenar_por, { ascending: !e.decrescente, nullsFirst: false });
    return contar ? q : q.range(de, ate);
  };

  if (e.apenas_contar) {
    const { count, error } = await montar(0, 0, true);
    return error ? `Erro: ${error.message}` : JSON.stringify({ tabela: e.tabela, quantidade: count });
  }

  if (agregando) {
    const linhas: Record<string, unknown>[] = [];
    for (let de = 0; de < LIMITE_AGREGACAO; de += 1000) {
      const { data, error } = await montar(de, de + 999);
      if (error) return `Erro: ${error.message}`;
      linhas.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < 1000) break;
    }
    const grupos = new Map<string, { grupo: string; linhas: number; somas: Record<string, number> }>();
    for (const l of linhas) {
      const chave = e.agrupar_por ? String(l[e.agrupar_por] ?? "(vazio)") : "total";
      const g = grupos.get(chave) ?? { grupo: chave, linhas: 0, somas: Object.fromEntries((e.somar ?? []).map((c) => [c, 0])) };
      g.linhas++;
      for (const c of e.somar ?? []) g.somas[c] += Number(l[c]) || 0;
      grupos.set(chave, g);
    }
    const ordenados = [...grupos.values()].sort((a, b) => {
      const c = e.somar?.[0];
      return c ? b.somas[c] - a.somas[c] : b.linhas - a.linhas;
    });
    let resultado: unknown[] = ordenados.map((g) => ({ ...g, somas: Object.fromEntries(Object.entries(g.somas).map(([k, v]) => [k, Math.round(v * 100) / 100])) }));
    if (e.agrupar_por === "imobiliaria_id") {
      const nomes = await comNomeImobiliaria(ordenados.map((g) => ({ imobiliaria_id: g.grupo })));
      resultado = resultado.map((g, i) => ({ ...(g as object), grupo: nomes[i].imobiliaria }));
    }
    return compacto({
      tabela: e.tabela,
      linhasLidas: linhas.length,
      ...(linhas.length === 0 ? { observacao: "Nenhuma linha. Pode ser que esse período ainda não tenha sido importado/registrado no Workspace -- não afirme que o valor é zero." } : {}),
      ...(linhas.length >= LIMITE_AGREGACAO ? { aviso: `leitura limitada a ${LIMITE_AGREGACAO} linhas -- use filtros` } : {}),
      grupos: resultado.slice(0, LIMITE_LINHAS),
      ...(resultado.length > LIMITE_LINHAS ? { gruposNaoMostrados: resultado.length - LIMITE_LINHAS } : {}),
    });
  }

  const limite = Math.min(Math.max(e.limite ?? 20, 1), LIMITE_LINHAS);
  const { data, error } = await montar(0, limite - 1);
  if (error) return `Erro: ${error.message}`;
  const linhas = await comNomeImobiliaria((data ?? []) as unknown as Record<string, unknown>[]);
  return compacto({
    tabela: e.tabela,
    linhas,
    // Vazio quase sempre é "ainda não importado/registrado", não "zero".
    ...(linhas.length === 0 ? { observacao: "Nenhuma linha. Pode ser que esse período ainda não tenha sido importado/registrado no Workspace -- não afirme que o valor é zero." } : {}),
  });
}

export async function executarFerramenta(nome: string, entrada: unknown): Promise<string> {
  try {
    if (nome === "consultar_painel") return await consultarPainel(entrada as { painel: string; competencia: string; partes?: string[] });
    if (nome === "consultar_tabela") return await consultarTabela(entrada as EntradaTabela);
    return `Ferramenta desconhecida: ${nome}`;
  } catch (e) {
    return `Erro ao consultar: ${e instanceof Error ? e.message : String(e)}`;
  }
}
