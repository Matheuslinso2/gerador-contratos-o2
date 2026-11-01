import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { compacto } from "@/lib/whatsappFerramentas";

// Análises que precisam do histórico inteiro e que, lendo tabela por tabela, estouravam o limite de tempo do chat
// (caso 01/11/2026: "quantas imobiliárias fizeram a primeira cotação em 2026?" deu timeout). Aqui o banco calcula tudo em uma consulta.

export const FERRAMENTA_PRIMEIRA_COTACAO: Anthropic.Tool = {
  name: "analisar_primeira_cotacao",
  description:
    "Responde 'quantas imobiliárias fizeram a PRIMEIRA cotação (nova) em um período', 'quais imobiliárias começaram a cotar em 2026', 'imobiliárias novas que cotaram em outubro'. Calcula no banco, em todo o histórico (planilhas + Bitrix), a data da primeira cotação nova de cada imobiliária (grupo conta como uma) e devolve total, divisão por produto e por mês e a lista. Opcionalmente por produto (fianca, re, capitalizacao, automovel). NÃO tente resolver esse tipo de pergunta lendo tabelas: use esta ferramenta.",
  input_schema: {
    type: "object",
    properties: {
      de: { type: "string", description: "Início do período, AAAA-MM-DD (ex.: 2026-01-01)." },
      ate: { type: "string", description: "Fim do período, AAAA-MM-DD (ex.: 2026-12-31)." },
      produto: { type: "string", description: "Opcional: fianca, re, capitalizacao ou automovel. Vazio = qualquer produto (a primeira em qualquer um)." },
    },
    required: ["de", "ate"],
  },
};

type Linha = { nome: string; primeira: string; produto_da_primeira: string; total_cotacoes: number; base_comeca: string | null; primeiro_documento: string | null };
const NOME_PRODUTO: Record<string, string> = { fianca: "Seguro Fiança", re: "Ramos Elementares", capitalizacao: "Capitalização", automovel: "Seguro Automóvel" };

export async function analisarPrimeiraCotacao(e: { de?: string; ate?: string; produto?: string }): Promise<string> {
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(e.de) || !ok(e.ate)) return JSON.stringify({ erro: "Informe 'de' e 'ate' no formato AAAA-MM-DD." });
  const produto = e.produto ? e.produto.toLowerCase().replace("incendio", "re") : null;
  if (produto && !NOME_PRODUTO[produto]) return JSON.stringify({ erro: "Produto desconhecido. Use fianca, re, capitalizacao ou automovel." });
  const { data, error } = await createServiceClient().rpc("chat_primeira_cotacao", { p_de: e.de, p_ate: e.ate, p_produto: produto });
  if (error) return `Erro: ${error.message}`;
  const todas = (data ?? []) as Linha[];
  // Cliente antigo: já tinha apólice emitida ANTES do período (a cotação só aparece nas planilhas/Bitrix agora). Não é imobiliária nova.
  const antigas = todas.filter((l) => l.primeiro_documento && l.primeiro_documento < (e.de as string));
  const linhas = todas.filter((l) => !(l.primeiro_documento && l.primeiro_documento < (e.de as string)));
  const porProduto: Record<string, number> = {};
  const porMes: Record<string, number> = {};
  for (const l of linhas) {
    const p = NOME_PRODUTO[l.produto_da_primeira] ?? l.produto_da_primeira;
    porProduto[p] = (porProduto[p] ?? 0) + 1;
    const m = l.primeira.slice(0, 7);
    porMes[m] = (porMes[m] ?? 0) + 1;
  }
  return compacto({
    periodo: `${e.de} a ${e.ate}`,
    produto: produto ? NOME_PRODUTO[produto] : "qualquer produto",
    imobiliariasRealmenteNovasComPrimeiraCotacaoNoPeriodo: linhas.length,
    outrasQueTinhamPrimeiraCotacaoRegistradaNoPeriodoMasJaTinhamApoliceAntes: antigas.length,
    totalSomandoAsDuas: todas.length,
    porProdutoDaPrimeiraCotacao: porProduto,
    porMes,
    lista: linhas.slice(0, 40).map((l) => ({ imobiliaria: l.nome, primeiraCotacao: l.primeira, produto: NOME_PRODUTO[l.produto_da_primeira] ?? l.produto_da_primeira, totalDeCotacoesNaBase: l.total_cotacoes })),
    ...(linhas.length > 40 ? { listaCortada: `Mostrei 40 de ${linhas.length}.` } : {}),
    exemplosDeClientesAntigos: antigas.slice(0, 5).map((l) => ({ imobiliaria: l.nome, primeiraCotacaoRegistrada: l.primeira, primeiraApolice: l.primeiro_documento })),
    avisos: [
      `O histórico da base começa em ${linhas[0]?.base_comeca ?? "2020"} (Fiança desde 2020; Ramos Elementares e os demais, bem mais recentes): "primeira cotação" quer dizer a primeira REGISTRADA na base.`,
      "Responda com o número das REALMENTE NOVAS e cite as demais à parte (eram clientes antigos). Cotação nova = não conta renovação nem apólice emitida; um grupo de imobiliárias conta como uma só; datas absurdas de planilha são ignoradas.",
    ],
  });
}

// ------------------------------------------------------------------ CUBO DE ESTATÍSTICAS
export const FERRAMENTA_CUBO: Anthropic.Tool = {
  name: "consultar_cubo",
  description:
    "ESTATÍSTICAS PRONTAS e instantâneas (cubo atualizado de hora em hora): quantidade, prêmio líquido e total, ticket médio, comissão, aluguel médio e parcelas, cruzando qualquer combinação de: fato (cotacao | proposta | apolice | endosso), período (mes, trimestre, semestre, ano), produto (fianca, incendio ou re, capitalizacao, automovel, condominio, vida...), tipo (novo | renovacao | endosso), fonte (bitrix, planilha, corp), status, imobiliária/grupo, seguradora, responsável (negociador/cotador), faixa de aluguel, bairro, cidade, nº de parcelas e forma de pagamento. Use para qualquer pergunta de total, média, ranking, evolução por mês/ano ou comparação ('comissão por produto e seguradora no semestre', 'ticket médio da Fiança por faixa de aluguel', 'cotações por imobiliária e produto em outubro'). É MUITO mais rápido e seguro que ler tabelas: prefira esta ferramenta sempre que couber. Fatos: cotacao = cards/planilhas do Workspace (status Em análise, Convertido, Perdido, Recusado, Aprovado); proposta = proposta em emissão (ERP); apolice = apólice emitida (vigente, vencida, cancelada; mês = início da vigência); endosso. Aluguel existe de forma confiável nas cotações de Fiança e, em parte, nas de Ramos Elementares; bairro/cidade vêm do endereço das planilhas de cotação (Fiança desde 2020 e Ramos Elementares desde 2025; metade das cotações de Fiança tem bairro, em parte inferido pelo CEP) e de parte das apólices de incêndio; o retorno traz 'cobertura' para você avisar o que ficou sem dado.",
  input_schema: {
    type: "object",
    properties: {
      agrupar: { type: "array", items: { type: "string", enum: ["fato", "mes", "trimestre", "semestre", "ano", "produto", "tipo", "fonte", "status", "entidade_nome", "seguradora", "responsavel", "faixa_aluguel", "bairro", "cidade", "parcelas", "forma_pagamento"] }, description: "Colunas para agrupar (cruzamento). Vazio = só o total." },
      fato: { type: "string", enum: ["cotacao", "proposta", "apolice", "endosso"] },
      produto: { type: "string", description: "fianca, incendio (ou re), capitalizacao, automovel, condominio, vida, rc, saude, portateis..." },
      tipo: { type: "string", enum: ["novo", "renovacao", "endosso"] },
      fonte: { type: "string", description: "bitrix, planilha, corp, ..." },
      status: { type: "string", description: "Em análise, Convertido, Perdido, Recusado, Aprovado (cotação) ou vigente, vencido, cancelado, proposta." },
      seguradora: { type: "string", description: "Nome normalizado: TOKIO, PORTO, POTTENCIAL, YELUM, BRASILCAP, ICATU, ALLIANZ, TOO..." },
      imobiliaria: { type: "string", description: "Nome da imobiliária ou grupo (inclui todas as fichas do grupo)." },
      responsavel: { type: "string", description: "Parte do nome do negociador/cotador." },
      bairro: { type: "string" },
      cidade: { type: "string" },
      faixa_aluguel: { type: "string", description: "Valor exato da faixa, ex.: '03 R$ 2.000 a 3.000'. Para ver as faixas, agrupe por faixa_aluguel." },
      parcelas: { type: "integer", description: "Nº de parcelas." },
      forma_pagamento: { type: "string" },
      mes_de: { type: "string", description: "AAAA-MM (início)." },
      mes_ate: { type: "string", description: "AAAA-MM (fim)." },
      limite: { type: "integer", description: "Máximo de linhas (padrão 50, máx. 300)." },
    },
  },
};

type EntradaCubo = {
  agrupar?: string[];
  fato?: string; produto?: string; tipo?: string; fonte?: string; status?: string; seguradora?: string; imobiliaria?: string; responsavel?: string;
  bairro?: string; cidade?: string; faixa_aluguel?: string; parcelas?: number; forma_pagamento?: string; mes_de?: string; mes_ate?: string; limite?: number;
};

export async function consultarCubo(e: EntradaCubo, verComissao: boolean): Promise<string> {
  const mesParaData = (m?: string) => (m && /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : undefined);
  const p: Record<string, unknown> = { ...e, mes_de: mesParaData(e.mes_de), mes_ate: mesParaData(e.mes_ate) };
  if ((e.mes_de && !p.mes_de) || (e.mes_ate && !p.mes_ate)) return JSON.stringify({ erro: "Use meses no formato AAAA-MM." });
  if (e.produto) p.produto = e.produto.toLowerCase() === "re" ? "incendio" : e.produto.toLowerCase();
  if (e.imobiliaria) {
    const { resolverImobiliarias } = await import("./roboFerramentas");
    const { fichas, grupo, ambiguo } = await resolverImobiliarias(e.imobiliaria);
    if (!fichas.length) return JSON.stringify({ encontrou: false, observacao: "Imobiliária não encontrada no banco único." });
    if (ambiguo) return JSON.stringify({ erro: "Nome de imobiliária ambíguo; peça um nome mais específico." });
    p.entidade_ids = [...new Set(fichas.map((f) => f.grupo_id ?? f.id))];
    p.imobiliariaConsiderada = grupo ?? fichas.map((f) => f.nome).join("; ");
  }
  delete p.imobiliaria;
  const { data, error } = await createServiceClient().rpc("chat_cubo_consultar", { p });
  if (error) return `Erro: ${error.message}`;
  const r = data as { linhas: Record<string, unknown>[]; total: Record<string, number>; atualizadoEm: string | null };
  // Comissão é financeiro: só admin vê.
  const limpa = (o: Record<string, unknown>) => (verComissao ? o : Object.fromEntries(Object.entries(o).filter(([k]) => k !== "comissao")));
  const t = r.total ?? {};
  const cobertura = {
    totalDeRegistros: t.qtd,
    comAluguel: t.com_aluguel,
    comBairro: t.com_bairro,
    comParcelas: t.com_parcelas,
  };
  return compacto({
    filtros: { ...e, imobiliaria: p.imobiliariaConsiderada ?? e.imobiliaria },
    total: limpa(t),
    linhas: (r.linhas ?? []).map(limpa),
    cobertura,
    cuboAtualizadoEm: r.atualizadoEm,
    avisos: [
      "Estatística do cubo (atualizado de hora em hora). Ticket médio = prêmio total ÷ quantidade com prêmio. Prêmio e comissão de COTAÇÃO são do card/planilha (previsto); os de APÓLICE e PROPOSTA vêm do ERP.",
      "Não some fatos diferentes (cotação, proposta e apólice) entre si. 'cobertura' mostra quantos registros têm aluguel, bairro e parcelas: avise quando a análise cobrir só parte.",
      ...(verComissao ? [] : ["Comissão não está liberada para este perfil."]),
    ],
  });
}

export async function executarFerramentaAnalises(nome: string, entrada: unknown, verComissao = false): Promise<string | null> {
  if (nome === FERRAMENTA_CUBO.name) {
    try {
      return await consultarCubo(entrada as EntradaCubo, verComissao);
    } catch (err) {
      return `Erro no cubo: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (nome !== FERRAMENTA_PRIMEIRA_COTACAO.name) return null;
  try {
    return await analisarPrimeiraCotacao(entrada as { de?: string; ate?: string; produto?: string });
  } catch (err) {
    return `Erro ao analisar: ${err instanceof Error ? err.message : String(err)}`;
  }
}
