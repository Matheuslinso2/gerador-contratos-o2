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

export async function executarFerramentaAnalises(nome: string, entrada: unknown): Promise<string | null> {
  if (nome !== FERRAMENTA_PRIMEIRA_COTACAO.name) return null;
  try {
    return await analisarPrimeiraCotacao(entrada as { de?: string; ate?: string; produto?: string });
  } catch (err) {
    return `Erro ao analisar: ${err instanceof Error ? err.message : String(err)}`;
  }
}
