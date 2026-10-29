import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

// Ferramentas do "Robô O2" do chat da equipe (Fase 2, 29/10/2026). Lê SÓ o banco do Workspace/ERP (nunca Bitrix
// ao vivo nem internet), somente leitura. Imobiliária é sempre resolvida pelo banco único (`imobiliarias` +
// `imobiliaria_grupos`): "Ramiro Sá" devolve o grupo inteiro, nunca uma lista paralela.
// O número de "apólices vigentes" usa a MESMA regra da tela ERP > Apólices > Vigentes (tipo Apólice + situação
// vigente); a ficha da imobiliária (erp_imobiliarias_resumo) conta todos os documentos vigentes (inclui endossos
// e faturas) e também é devolvida, para a IA explicar a diferença em vez de escolher um número em silêncio.

const MAX_FICHAS = 15;
const LIMITE_LEITURA = 40000;

function normalizar(s: string | null | undefined) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function casaTodos(texto: string, consulta: string) {
  const palavras = texto.split(" ");
  return consulta
    .split(" ")
    .filter(Boolean)
    .every((t) => palavras.some((p) => (t.length <= 2 ? p === t : p.startsWith(t))));
}

type Ficha = { id: string; nome: string; apelido: string | null; grupo_id: string | null; codigo_produtor_corp: string | null };

async function resolverImobiliarias(nome: string): Promise<{ fichas: Ficha[]; grupo: string | null; ambiguo: boolean }> {
  const sb = createServiceClient();
  const [{ data: imobs }, { data: grupos }] = await Promise.all([
    sb.from("imobiliarias").select("id, nome, apelido, grupo_id, codigo_produtor_corp").limit(5000),
    sb.from("imobiliaria_grupos").select("id, nome").limit(2000),
  ]);
  const nomeGrupo = new Map((grupos ?? []).map((g) => [g.id as string, g.nome as string]));
  const q = normalizar(nome);
  if (!q) return { fichas: [], grupo: null, ambiguo: false };
  const todas = (imobs ?? []) as Ficha[];
  const achadas = todas.filter((i) =>
    casaTodos(normalizar(`${i.nome} ${i.apelido ?? ""} ${i.grupo_id ? (nomeGrupo.get(i.grupo_id) ?? "") : ""}`), q)
  );
  // Se a busca bate no nome de um grupo, entram todas as fichas do grupo.
  const gruposAchados = new Set(achadas.map((i) => i.grupo_id).filter((g): g is string => !!g && casaTodos(normalizar(nomeGrupo.get(g)), q)));
  const fichas = new Map(achadas.map((i) => [i.id, i]));
  for (const i of todas) if (i.grupo_id && gruposAchados.has(i.grupo_id)) fichas.set(i.id, i);
  const lista = [...fichas.values()];
  const grupo = gruposAchados.size === 1 ? (nomeGrupo.get([...gruposAchados][0]) ?? null) : null;
  return { fichas: lista, grupo, ambiguo: lista.length > MAX_FICHAS };
}

export const FERRAMENTAS_ERP: Anthropic.Tool[] = [
  {
    name: "buscar_imobiliaria",
    description:
      "Procura uma imobiliária pelo nome (sem diferenciar acento/maiúscula; aceita parte do nome ou nome do grupo, ex.: 'ramiro sa'). Devolve as fichas do banco único (inclui todas as fichas do mesmo grupo) com o resumo do ERP de cada uma: documentos vigentes, prêmio vigente, propostas pendentes, faturas, produtos e seguradoras vigentes, fim da última vigência, e o total do grupo. Use SEMPRE antes de responder sobre uma imobiliária.",
    input_schema: { type: "object", properties: { nome: { type: "string" } }, required: ["nome"] },
  },
  {
    name: "contar_documentos_erp",
    description:
      "Conta (e soma prêmio) documentos do ERP, com os mesmos filtros das telas do ERP. tipo: A=Apólice, C=Endosso de cobrança, D=Devolução, F=Fatura, I=End. cancelamento de item, M=Endosso sem prêmio, R=Endosso de restituição, X=End. cancelamento de apólice. situacao: vigente, vencido, cancelado (cotação, proposta, perdido e recusado NÃO são apólice e são recusados aqui). 'Apólices vigentes' = tipo ['A'] + situacao ['vigente'] (a mesma regra da tela ERP > Apólices > Vigentes). Sem 'imobiliaria', conta a empresa toda (só use com apenas filtros e sem agrupar_por 'imobiliaria').",
    input_schema: {
      type: "object",
      properties: {
        imobiliaria: { type: "string", description: "Nome (ou parte) da imobiliária ou do grupo; inclui todas as fichas do grupo." },
        tipo: { type: "array", items: { type: "string" } },
        situacao: { type: "array", items: { type: "string" } },
        seguradora: { type: "string", description: "Parte do nome ou sigla (ex.: 'porto', 'pottencial', 'tokio')." },
        produto: { type: "string", description: "fianca, incendio, capitalizacao, automovel, vida, condominio, rc, saude, portateis, outros." },
        vigencia_inicio_de: { type: "string", description: "AAAA-MM-DD" },
        vigencia_inicio_ate: { type: "string", description: "AAAA-MM-DD" },
        vigencia_fim_de: { type: "string", description: "AAAA-MM-DD (ex.: a vencer a partir de)" },
        vigencia_fim_ate: { type: "string", description: "AAAA-MM-DD (ex.: a vencer até)" },
        agrupar_por: { type: "string", enum: ["situacao", "tipo", "seguradora", "produto", "imobiliaria"] },
      },
    },
  },
];

type EntradaContar = {
  imobiliaria?: string;
  tipo?: string[];
  situacao?: string[];
  seguradora?: string;
  produto?: string;
  vigencia_inicio_de?: string;
  vigencia_inicio_ate?: string;
  vigencia_fim_de?: string;
  vigencia_fim_ate?: string;
  agrupar_por?: "situacao" | "tipo" | "seguradora" | "produto" | "imobiliaria";
};

async function buscarImobiliaria(e: { nome: string }, verComissao: boolean): Promise<string> {
  const { fichas, grupo, ambiguo } = await resolverImobiliarias(e.nome);
  if (!fichas.length) return JSON.stringify({ encontrou: false, observacao: "Nenhuma imobiliária com esse nome no banco único. Peça para o usuário conferir a grafia." });
  if (ambiguo)
    return JSON.stringify({ encontrou: true, ambiguo: true, observacao: `Mais de ${MAX_FICHAS} fichas batem. Peça um nome mais específico.`, exemplos: fichas.slice(0, MAX_FICHAS).map((f) => f.nome) });
  const sb = createServiceClient();
  const { data: resumos } = await sb
    .from("erp_imobiliarias_resumo")
    .select("imobiliaria_id, docs_total, docs_vigentes, premio_vigente, comissao_vigente, produtos, seguradoras, propostas_pendentes, faturas, ultima_vigencia, calculado_em")
    .in("imobiliaria_id", fichas.map((f) => f.id));
  const porId = new Map((resumos ?? []).map((r) => [r.imobiliaria_id as string, r]));
  const linhas = fichas.map((f) => {
    const r = porId.get(f.id);
    return {
      ficha: f.nome,
      apelido: f.apelido,
      codigoCorp: f.codigo_produtor_corp,
      docsTotal: r?.docs_total ?? 0,
      docsVigentesNaFichaDoErp: r?.docs_vigentes ?? 0,
      premioVigente: r?.premio_vigente != null ? Number(r.premio_vigente) : 0,
      ...(verComissao ? { comissaoVigente: r?.comissao_vigente != null ? Number(r.comissao_vigente) : 0 } : {}),
      propostasEmEmissao: r?.propostas_pendentes ?? 0,
      faturas: r?.faturas ?? 0,
      produtosVigentes: r?.produtos ?? [],
      seguradorasVigentes: r?.seguradoras ?? [],
      ultimaVigencia: r?.ultima_vigencia ?? null,
      resumoAtualizadoEm: r?.calculado_em ?? null,
    };
  });
  const soma = (k: "docsTotal" | "docsVigentesNaFichaDoErp" | "premioVigente") => linhas.reduce((a, l) => a + (Number(l[k]) || 0), 0);
  return JSON.stringify({
    encontrou: true,
    grupo,
    fichas: linhas,
    totalDoGrupo: { docsTotal: soma("docsTotal"), docsVigentesNaFichaDoErp: soma("docsVigentesNaFichaDoErp"), premioVigente: Math.round(soma("premioVigente") * 100) / 100 },
    nota: "docsVigentesNaFichaDoErp conta TODO documento vigente (apólices, endossos, faturas). Para separar apólices (tipo A) de endossos (C, D, I, M, R, X) vigentes, use contar_documentos_erp com situacao ['vigente'] e agrupar_por 'tipo'.",
  });
}

async function contarDocumentos(e: EntradaContar, verComissao: boolean): Promise<string> {
  // Cotação e proposta não são apólice (glossário do Matheus, 27/10): cotação vive nos painéis do Workspace e
  // proposta em Emissão (propostasEmEmissao de buscar_imobiliaria). Perdido/recusado ficam fora do ERP.
  const NAO_APOLICE = ["cotacao", "proposta", "perdido", "recusado", "duplicado"];
  const barradas = (e.situacao ?? []).filter((s) => NAO_APOLICE.includes(s));
  if (barradas.length)
    return JSON.stringify({
      erro: `Situação(ões) ${barradas.join(", ")} não são apólice. Cotação = painéis do Workspace (consultar_painel); proposta = propostasEmEmissao de buscar_imobiliaria.`,
    });
  const sb = createServiceClient();
  let ids: string[] | null = null;
  let nomes = new Map<string, string>();
  if (e.imobiliaria) {
    const { fichas, grupo, ambiguo } = await resolverImobiliarias(e.imobiliaria);
    if (!fichas.length) return JSON.stringify({ encontrou: false, observacao: "Imobiliária não encontrada no banco único." });
    if (ambiguo) return JSON.stringify({ ambiguo: true, observacao: `Mais de ${MAX_FICHAS} fichas batem. Peça um nome mais específico.`, exemplos: fichas.slice(0, MAX_FICHAS).map((f) => f.nome) });
    ids = fichas.map((f) => f.id);
    nomes = new Map(fichas.map((f) => [f.id, f.nome]));
    if (grupo) nomes.set("__grupo", grupo);
  } else if (e.agrupar_por === "imobiliaria") {
    return JSON.stringify({ erro: "Agrupar por imobiliária exige informar 'imobiliaria'." });
  }

  const [{ data: segs }, { data: ramos }] = await Promise.all([
    sb.from("erp_seguradoras").select("id, nome, abreviacao"),
    sb.from("erp_ramos").select("id, nome, produto"),
  ]);
  const segNome = new Map((segs ?? []).map((s) => [s.id as string, (s.nome as string) || (s.abreviacao as string)]));
  const ramoProduto = new Map((ramos ?? []).map((r) => [r.id as string, (r.produto as string) ?? "outros"]));
  let segIds: string[] | null = null;
  if (e.seguradora) {
    const q = normalizar(e.seguradora);
    segIds = (segs ?? []).filter((s) => normalizar(`${s.nome} ${s.abreviacao}`).includes(q)).map((s) => s.id as string);
    if (!segIds.length) return JSON.stringify({ encontrou: false, observacao: "Seguradora não encontrada no cadastro do ERP." });
  }
  let ramoIds: string[] | null = null;
  if (e.produto) {
    const q = normalizar(e.produto);
    ramoIds = (ramos ?? []).filter((r) => normalizar(r.produto as string) === q).map((r) => r.id as string);
    if (!ramoIds.length) return JSON.stringify({ encontrou: false, observacao: "Produto desconhecido. Use: fianca, incendio, capitalizacao, automovel, vida, condominio, rc, saude, portateis, outros." });
  }

  const colunas = "tipo, situacao, seguradora_id, ramo_id, imobiliaria_principal_id, premio_total" + (verComissao ? ", comissao_valor" : "");
  const montar = (de: number, ate: number) => {
    let q = sb.from("erp_documentos").select(colunas).order("id");
    if (ids) q = q.in("imobiliaria_principal_id", ids);
    if (e.tipo?.length) q = q.in("tipo", e.tipo);
    if (e.situacao?.length) q = q.in("situacao", e.situacao);
    else q = q.not("situacao", "in", `(${NAO_APOLICE.join(",")})`);
    if (segIds) q = q.in("seguradora_id", segIds);
    if (ramoIds) q = q.in("ramo_id", ramoIds);
    if (e.vigencia_inicio_de) q = q.gte("vigencia_inicio", e.vigencia_inicio_de);
    if (e.vigencia_inicio_ate) q = q.lte("vigencia_inicio", e.vigencia_inicio_ate);
    if (e.vigencia_fim_de) q = q.gte("vigencia_fim", e.vigencia_fim_de);
    if (e.vigencia_fim_ate) q = q.lte("vigencia_fim", e.vigencia_fim_ate);
    return q.range(de, ate);
  };

  type Linha = { tipo: string; situacao: string; seguradora_id: string | null; ramo_id: string | null; imobiliaria_principal_id: string | null; premio_total: number | null; comissao_valor?: number | null };
  const linhas: Linha[] = [];
  for (let de = 0; de < LIMITE_LEITURA; de += 1000) {
    const { data, error } = await montar(de, de + 999);
    if (error) return `Erro: ${error.message}`;
    linhas.push(...((data ?? []) as unknown as Linha[]));
    if (!data || data.length < 1000) break;
  }
  const truncado = linhas.length >= LIMITE_LEITURA;

  const rotulo = (l: Linha): string => {
    switch (e.agrupar_por) {
      case "situacao": return l.situacao;
      case "tipo": return l.tipo;
      case "seguradora": return (l.seguradora_id && segNome.get(l.seguradora_id)) || "(sem seguradora)";
      case "produto": return (l.ramo_id && ramoProduto.get(l.ramo_id)) || "(sem produto)";
      case "imobiliaria": return (l.imobiliaria_principal_id && nomes.get(l.imobiliaria_principal_id)) || "(outra)";
      default: return "total";
    }
  };
  const grupos = new Map<string, { grupo: string; quantidade: number; premioTotal: number; comissao: number }>();
  for (const l of linhas) {
    const k = rotulo(l);
    const g = grupos.get(k) ?? { grupo: k, quantidade: 0, premioTotal: 0, comissao: 0 };
    g.quantidade++;
    g.premioTotal += Number(l.premio_total) || 0;
    g.comissao += Number(l.comissao_valor) || 0;
    grupos.set(k, g);
  }
  const resultado = [...grupos.values()]
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 40)
    .map((g) => ({ grupo: g.grupo, quantidade: g.quantidade, premioTotal: Math.round(g.premioTotal * 100) / 100, ...(verComissao ? { comissao: Math.round(g.comissao * 100) / 100 } : {}) }));
  return JSON.stringify({
    filtros: { ...e, imobiliaria: undefined },
    imobiliariaConsiderada: e.imobiliaria ? { grupo: nomes.get("__grupo") ?? null, fichas: [...nomes.entries()].filter(([k]) => k !== "__grupo").map(([, n]) => n) } : "empresa toda",
    totalDocumentos: linhas.length,
    ...(truncado ? { aviso: `Leitura limitada a ${LIMITE_LEITURA} documentos -- o total real é maior. Use mais filtros.` } : {}),
    ...(linhas.length === 0 ? { observacao: "Nenhum documento com esses filtros." } : {}),
    grupos: resultado,
  });
}

export async function executarFerramentaErp(nome: string, entrada: unknown, verComissao: boolean): Promise<string | null> {
  try {
    if (nome === "buscar_imobiliaria") return await buscarImobiliaria(entrada as { nome: string }, verComissao);
    if (nome === "contar_documentos_erp") return await contarDocumentos(entrada as EntradaContar, verComissao);
    return null;
  } catch (err) {
    return `Erro ao consultar: ${err instanceof Error ? err.message : String(err)}`;
  }
}
