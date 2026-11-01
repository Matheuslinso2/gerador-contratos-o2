import "server-only";

import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarEmLotes } from "@/lib/supabase/emLotes";
import { resolverImobiliarias } from "./roboFerramentas";

// Relatório em PDF dos documentos do ERP pedido no chat (Matheus, 01/11/2026: "traga todas as apólices da Ramiro Sá
// do primeiro semestre" -> PDF em forma de relatório, não Excel). A lista é montada AQUI, direto do banco, e não pela
// IA: a IA só escolhe os filtros, então nenhum número ou apólice pode ser "inventado" na transcrição.
// O PDF vai para o bucket privado `relatorios-robo` e o chat recebe um link assinado temporário.

const NAO_APOLICE = ["cotacao", "proposta", "perdido", "recusado", "duplicado"];
const LIMITE_DOCS = 3000;
const VALIDADE_LINK_SEG = 6 * 60 * 60;
const TIPOS: Record<string, string> = { A: "Apólice", C: "End. cobrança", D: "Devolução", F: "Fatura", I: "End. cancel. item", M: "End. sem prêmio", R: "End. restituição", X: "End. cancel. apólice" };

export const FERRAMENTA_RELATORIO: Anthropic.Tool = {
  name: "gerar_relatorio_pdf",
  description:
    "Gera um RELATÓRIO EM PDF com a lista completa de documentos do ERP (apólices, endossos, faturas) com filtros, e devolve um link para baixar. Use quando o usuário pedir 'traga todas', 'lista', 'relatório' ou quando a lista tiver mais de ~15 itens (o chat não comporta listas grandes). O PDF traz resumo (total, prêmio, por seguradora e por mês) e a tabela completa (nº do documento, tipo, imobiliária, seguradora, ramo, vigência, situação, prêmio). O relatório NÃO traz dados pessoais de segurados ou inquilinos (nome, CPF, e-mail, telefone): isso fica só em texto no chat. Escreva também descricao_do_filtro. Se o período for pedido, 'campo_periodo' é OBRIGATÓRIO: se o usuário não deixou claro o critério (ex.: 'primeiro semestre'), PERGUNTE antes qual quer: inicio_vigencia (apólices que começaram no período), vigente_no_periodo (vigentes em algum dia do período) ou fim_vigencia (que vencem no período). Depois de gerar, mostre o link e um resumo curto (total e principais números do PDF).",
  input_schema: {
    type: "object",
    properties: {
      imobiliaria: { type: "string", description: "Nome (ou parte) da imobiliária ou do grupo; inclui todas as fichas do grupo. Omitir = empresa toda (exige outro filtro)." },
      tipo: { type: "array", items: { type: "string" }, description: "A=Apólice (padrão), C/D/I/M/R/X=endossos, F=Fatura." },
      situacao: { type: "array", items: { type: "string" }, description: "vigente, vencido, cancelado. Omitir = todas as emitidas." },
      seguradora: { type: "string" },
      produto: { type: "string", description: "fianca, incendio, capitalizacao, automovel, vida, condominio, rc, saude, portateis, outros." },
      campo_periodo: { type: "string", enum: ["inicio_vigencia", "vigente_no_periodo", "fim_vigencia"] },
      de: { type: "string", description: "AAAA-MM-DD" },
      ate: { type: "string", description: "AAAA-MM-DD" },
      titulo: { type: "string", description: "Título do relatório (opcional)." },
      descricao_do_filtro: { type: "string", description: "Frase em português com a lógica do filtro, para o cabeçalho. Ex.: 'Propostas emitidas (apólices) pertencentes à imobiliária XPFG, com início de vigência entre 01/01/2026 e 30/06/2026.' Se omitida, o relatório monta uma a partir dos filtros." },
    },
  },
};

type Entrada = {
  imobiliaria?: string;
  tipo?: string[];
  situacao?: string[];
  seguradora?: string;
  produto?: string;
  campo_periodo?: "inicio_vigencia" | "vigente_no_periodo" | "fim_vigencia";
  de?: string;
  ate?: string;
  titulo?: string;
  descricao_do_filtro?: string;
};

type Doc = {
  id: string;
  tipo: string;
  situacao: string;
  numero_apolice: string | null;
  numero_endosso: string | null;
  seguradora_id: string | null;
  ramo_id: string | null;
  imobiliaria_principal_id: string | null;
  locatario_id: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  premio_total: number | null;
  comissao_valor?: number | null;
};

const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const reais = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
// Helvetica padrão só codifica WinAnsi: troca o que não cabe por "?".
const limpar = (s: string) => s.replace(/[^\x20-\x7E -ÿ–—•’‘“”…€]/g, "?");

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cortar(texto: string, fonte: PDFFont, tamanho: number, largura: number) {
  let t = limpar(texto);
  if (fonte.widthOfTextAtSize(t, tamanho) <= largura) return t;
  while (t.length > 1 && fonte.widthOfTextAtSize(t + "…", tamanho) > largura) t = t.slice(0, -1);
  return t + "…";
}

async function montarPdf(p: {
  titulo: string;
  filtros: string[];
  docs: { cols: string[] }[];
  colunas: { nome: string; largura: number; direita?: boolean }[];
  resumo: { total: number; premio: number; comissao: number | null; porSeguradora: [string, number, number][]; porMes: [string, number][] };
  geradoPor: string;
  truncado: boolean;
}) {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = 841.89;
  const A = 595.28;
  const M = 36;
  const navy = rgb(0.004, 0.098, 0.18);
  const coral = rgb(0.973, 0.329, 0.051);
  const cinza = rgb(0.45, 0.45, 0.45);
  let pagina!: PDFPage;
  let y = 0;
  const paginas: PDFPage[] = [];

  const novaPagina = () => {
    pagina = pdf.addPage([L, A]);
    paginas.push(pagina);
    pagina.drawRectangle({ x: 0, y: A - 6, width: L, height: 6, color: coral });
    y = A - M - 6;
  };
  const texto = (t: string, x: number, yy: number, tam: number, f: PDFFont = fonte, cor = rgb(0.12, 0.12, 0.12)) =>
    pagina.drawText(limpar(t), { x, y: yy, size: tam, font: f, color: cor });

  novaPagina();
  texto("O2 Seguros", M, y - 4, 9, negrito, coral);
  texto("Relatório gerado pelo Robô O2", L - M - 150, y - 4, 8, fonte, cinza);
  y -= 30;
  texto(p.titulo, M, y, 17, negrito, navy);
  y -= 16;
  // Lógica do filtro: frase única, em tamanho menor que o título (padrão pedido pelo Matheus em 01/11/2026).
  {
    const frase = limpar("Filtro aplicado: " + p.filtros.join(" "));
    let linha = "";
    for (const palavra of frase.split(" ")) {
      const cand = linha ? linha + " " + palavra : palavra;
      if (fonte.widthOfTextAtSize(cand, 8) > L - M * 2 && linha) {
        texto(linha, M, y, 8, fonte, cinza);
        y -= 10;
        linha = palavra;
      } else linha = cand;
    }
    if (linha) {
      texto(linha, M, y, 8, fonte, cinza);
      y -= 10;
    }
  }
  y -= 10;

  // Resumo
  texto("Resumo", M, y, 11, negrito, navy);
  y -= 15;
  texto(`Total de documentos: ${p.resumo.total.toLocaleString("pt-BR")}`, M, y, 10);
  texto(`Prêmio total: ${reais(p.resumo.premio)}`, M + 220, y, 10);
  if (p.resumo.comissao != null) texto(`Comissão: ${reais(p.resumo.comissao)}`, M + 440, y, 10);
  y -= 18;
  if (p.truncado) {
    texto(`Atenção: lista limitada aos primeiros ${LIMITE_DOCS.toLocaleString("pt-BR")} documentos; o total real é maior. Use mais filtros.`, M, y, 9, negrito, coral);
    y -= 16;
  }
  const blocoY = y;
  texto("Por seguradora", M, y, 9, negrito, navy);
  let yy = y - 12;
  for (const [nome, n, prem] of p.resumo.porSeguradora.slice(0, 14)) {
    texto(`${cortar(nome, fonte, 8.5, 190)}`, M, yy, 8.5);
    texto(`${n}`, M + 200, yy, 8.5);
    texto(reais(prem), M + 232, yy, 8.5);
    yy -= 11;
  }
  texto("Por mês de início de vigência", M + 400, blocoY, 9, negrito, navy);
  let ym = blocoY - 12;
  for (const [mes, n] of p.resumo.porMes.slice(0, 14)) {
    texto(mes, M + 400, ym, 8.5);
    texto(`${n}`, M + 470, ym, 8.5);
    ym -= 11;
  }
  y = Math.min(yy, ym) - 14;

  // Tabela
  const desenharCabecalho = () => {
    pagina.drawRectangle({ x: M, y: y - 4, width: L - M * 2, height: 15, color: navy });
    let x = M + 3;
    for (const c of p.colunas) {
      const w = c.largura;
      texto(c.nome, c.direita ? x + w - 6 - negrito.widthOfTextAtSize(limpar(c.nome), 8) : x, y, 8, negrito, rgb(1, 1, 1));
      x += w;
    }
    y -= 17;
  };
  if (y < 90) novaPagina();
  desenharCabecalho();
  let zebra = false;
  for (const linha of p.docs) {
    if (y < M + 14) {
      novaPagina();
      desenharCabecalho();
    }
    if (zebra) pagina.drawRectangle({ x: M, y: y - 3, width: L - M * 2, height: 11, color: rgb(0.94, 0.95, 0.96) });
    zebra = !zebra;
    let x = M + 3;
    p.colunas.forEach((c, i) => {
      const t = cortar(linha.cols[i] ?? "", fonte, 7.5, c.largura - 6);
      texto(t, c.direita ? x + c.largura - 6 - fonte.widthOfTextAtSize(t, 7.5) : x, y, 7.5);
      x += c.largura;
    });
    y -= 11;
  }

  const total = paginas.length;
  paginas.forEach((pg, i) => {
    pg.drawText(limpar(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} por ${p.geradoPor} · uso interno da O2 Seguros · página ${i + 1} de ${total}`), {
      x: M,
      y: 18,
      size: 7.5,
      font: fonte,
      color: cinza,
    });
  });
  return pdf.save();
}

export async function gerarRelatorioPdf(e: Entrada, email: string, verComissao: boolean): Promise<string> {
  const sb = createServiceClient();
  const filtros: string[] = [];

  let ids: string[] | null = null;
  if (e.imobiliaria) {
    const { fichas, grupo, ambiguo, aproximado } = await resolverImobiliarias(e.imobiliaria);
    if (!fichas.length) return JSON.stringify({ erro: "Imobiliária não encontrada no banco único." });
    if (ambiguo) return JSON.stringify({ erro: "Muitas fichas batem com esse nome; peça um nome mais específico.", exemplos: fichas.slice(0, 10).map((f) => f.nome) });
    ids = fichas.map((f) => f.id);
    filtros.push(`Imobiliária: ${grupo ? `grupo ${grupo} (${fichas.map((f) => f.nome).join("; ")})` : fichas.map((f) => f.nome).join("; ")}${aproximado ? " [nome aproximado]" : ""}`);
  } else if (!e.situacao?.length && !e.seguradora && !e.produto && !e.de && !e.ate) {
    return JSON.stringify({ erro: "Sem imobiliária, informe pelo menos um outro filtro (período, seguradora, produto ou situação)." });
  }
  if ((e.de || e.ate) && !e.campo_periodo) return JSON.stringify({ erro: "Informe campo_periodo (inicio_vigencia, vigente_no_periodo ou fim_vigencia). Se o usuário não deixou claro, pergunte a ele." });

  const [{ data: segs }, { data: ramos }] = await Promise.all([sb.from("erp_seguradoras").select("id, nome, abreviacao"), sb.from("erp_ramos").select("id, nome, produto")]);
  let segIds: string[] | null = null;
  if (e.seguradora) {
    const q = norm(e.seguradora);
    segIds = (segs ?? []).filter((s) => norm(`${s.nome} ${s.abreviacao}`).includes(q)).map((s) => s.id as string);
    if (!segIds.length) return JSON.stringify({ erro: "Seguradora não encontrada." });
    filtros.push(`Seguradora: ${e.seguradora}`);
  }
  let ramoIds: string[] | null = null;
  if (e.produto) {
    ramoIds = (ramos ?? []).filter((r) => norm(r.produto as string) === norm(e.produto!)).map((r) => r.id as string);
    if (!ramoIds.length) return JSON.stringify({ erro: "Produto desconhecido." });
    filtros.push(`Produto: ${e.produto}`);
  }
  const tipos = e.tipo?.length ? e.tipo : ["A"];
  filtros.push(`Tipo: ${tipos.map((t) => TIPOS[t] ?? t).join(", ")}`);
  const situacoes = e.campo_periodo === "vigente_no_periodo" ? ["vigente", "vencido"] : e.situacao;
  if (e.situacao?.length) filtros.push(`Situação: ${e.situacao.join(", ")}`);
  const rotuloCampo = { inicio_vigencia: "início de vigência", vigente_no_periodo: "vigente em algum dia do período", fim_vigencia: "fim de vigência (vencimento)" };
  if (e.de || e.ate) filtros.push(`Período (${rotuloCampo[e.campo_periodo!]}): ${dataBr(e.de ?? null)} a ${dataBr(e.ate ?? null)}`);

  const cols = "id, tipo, situacao, numero_apolice, numero_endosso, seguradora_id, ramo_id, imobiliaria_principal_id, locatario_id, vigencia_inicio, vigencia_fim, premio_total" + (verComissao ? ", comissao_valor" : "");
  const docs: Doc[] = [];
  for (let de = 0; de < LIMITE_DOCS; de += 1000) {
    let q = sb.from("erp_documentos").select(cols).order("vigencia_inicio", { ascending: true }).order("id").range(de, Math.min(de + 999, LIMITE_DOCS - 1));
    q = q.in("tipo", tipos);
    if (ids) q = q.in("imobiliaria_principal_id", ids);
    if (situacoes?.length) q = q.in("situacao", situacoes);
    else q = q.not("situacao", "in", `(${NAO_APOLICE.join(",")})`);
    if (segIds) q = q.in("seguradora_id", segIds);
    if (ramoIds) q = q.in("ramo_id", ramoIds);
    if (e.campo_periodo === "inicio_vigencia") {
      if (e.de) q = q.gte("vigencia_inicio", e.de);
      if (e.ate) q = q.lte("vigencia_inicio", e.ate);
    } else if (e.campo_periodo === "fim_vigencia") {
      if (e.de) q = q.gte("vigencia_fim", e.de);
      if (e.ate) q = q.lte("vigencia_fim", e.ate);
    } else if (e.campo_periodo === "vigente_no_periodo") {
      if (e.ate) q = q.lte("vigencia_inicio", e.ate);
      if (e.de) q = q.gte("vigencia_fim", e.de);
    }
    const { data, error } = await q;
    if (error) return JSON.stringify({ erro: error.message });
    docs.push(...((data ?? []) as unknown as Doc[]));
    if (!data || data.length < 1000) break;
  }
  if (!docs.length) return JSON.stringify({ total: 0, observacao: "Nenhum documento com esses filtros; nenhum PDF gerado." });
  const truncado = docs.length >= LIMITE_DOCS;

  // Nomes: segurado/titular, seguradora, ramo, imobiliária.
  const segNome = new Map((segs ?? []).map((s) => [s.id as string, ((s.nome as string) || (s.abreviacao as string)).replace(/ SEGUROS?.*$/i, "")]));
  const ramoNome = new Map((ramos ?? []).map((r) => [r.id as string, r.nome as string]));
  const imobIds = [...new Set(docs.map((d) => d.imobiliaria_principal_id).filter((v): v is string => !!v))];
  const imobs = !ids || ids.length > 1 ? await buscarEmLotes(imobIds, (lote) => sb.from("imobiliarias").select("id, nome").in("id", lote)) : [];
  const nomeImob = new Map(imobs.map((i) => [i.id as string, i.nome as string]));
  const mostrarImob = !ids || ids.length > 1;

  const porSeg = new Map<string, [number, number]>();
  const porMes = new Map<string, number>();
  let premio = 0;
  let comissao = 0;
  for (const d of docs) {
    const s = segNome.get(d.seguradora_id ?? "") ?? "(sem seguradora)";
    const v = porSeg.get(s) ?? [0, 0];
    v[0]++;
    v[1] += Number(d.premio_total) || 0;
    porSeg.set(s, v);
    const mes = d.vigencia_inicio ? d.vigencia_inicio.slice(0, 7).split("-").reverse().join("/") : "sem data";
    porMes.set(mes, (porMes.get(mes) ?? 0) + 1);
    premio += Number(d.premio_total) || 0;
    comissao += Number(d.comissao_valor) || 0;
  }

  const colunas = [
    { nome: "Nº documento", largura: 92 },
    { nome: "Tipo", largura: 62 },
    ...(mostrarImob ? [{ nome: "Imobiliária", largura: 190 }] : []),
    { nome: "Seguradora", largura: mostrarImob ? 100 : 170 },
    { nome: "Ramo", largura: mostrarImob ? 100 : 170 },
    { nome: "Início", largura: 52 },
    { nome: "Fim", largura: 52 },
    { nome: "Situação", largura: 50 },
    { nome: "Prêmio total", largura: 66, direita: true },
    ...(verComissao ? [{ nome: "Comissão", largura: 60, direita: true }] : []),
  ];
  const linhas = docs.map((d) => ({
    cols: [
      d.numero_apolice ?? d.numero_endosso ?? "—",
      TIPOS[d.tipo] ?? d.tipo,
      ...(mostrarImob ? [nomeImob.get(d.imobiliaria_principal_id ?? "") ?? "—"] : []),
      segNome.get(d.seguradora_id ?? "") ?? "—",
      ramoNome.get(d.ramo_id ?? "") ?? "—",
      dataBr(d.vigencia_inicio),
      dataBr(d.vigencia_fim),
      d.situacao,
      reais(d.premio_total),
      ...(verComissao ? [reais(d.comissao_valor)] : []),
    ],
  }));

  const titulo = e.titulo ?? `Relatório de ${tipos.length === 1 && tipos[0] === "A" ? "apólices" : "documentos"} do ERP`;
  const bytes = await montarPdf({
    titulo,
    filtros: [e.descricao_do_filtro?.trim() ? limpar(e.descricao_do_filtro.trim().slice(0, 600)) : filtros.join("; ") + "."],
    docs: linhas,
    colunas,
    resumo: {
      total: docs.length,
      premio,
      comissao: verComissao ? comissao : null,
      porSeguradora: [...porSeg.entries()].map(([n, v]) => [n, v[0], v[1]] as [string, number, number]).sort((a, b) => b[1] - a[1]),
      porMes: [...porMes.entries()].sort((a, b) => a[0].split("/").reverse().join().localeCompare(b[0].split("/").reverse().join())),
    },
    geradoPor: email,
    truncado,
  });

  const caminho = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.pdf`;
  const { error: errUp } = await sb.storage.from("relatorios-robo").upload(caminho, bytes, { contentType: "application/pdf" });
  if (errUp) return JSON.stringify({ erro: `Não consegui guardar o PDF: ${errUp.message}` });
  const { data: assinado, error: errUrl } = await sb.storage.from("relatorios-robo").createSignedUrl(caminho, VALIDADE_LINK_SEG, { download: `relatorio-${new Date().toISOString().slice(0, 10)}.pdf` });
  if (errUrl || !assinado) return JSON.stringify({ erro: "Não consegui gerar o link do PDF." });

  return JSON.stringify({
    link: assinado.signedUrl,
    validadeHoras: VALIDADE_LINK_SEG / 3600,
    totalDocumentos: docs.length,
    premioTotal: Math.round(premio * 100) / 100,
    ...(verComissao ? { comissaoTotal: Math.round(comissao * 100) / 100 } : {}),
    porSeguradora: [...porSeg.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 8).map(([n, v]) => ({ seguradora: n, quantidade: v[0] })),
    filtros,
    ...(truncado ? { aviso: `Lista limitada a ${LIMITE_DOCS} documentos.` } : {}),
  });
}

export async function executarFerramentaRelatorio(nome: string, entrada: unknown, email: string, verComissao: boolean): Promise<string | null> {
  if (nome !== "gerar_relatorio_pdf") return null;
  try {
    return await gerarRelatorioPdf(entrada as Entrada, email, verComissao);
  } catch (err) {
    return `Erro ao gerar o relatório: ${err instanceof Error ? err.message : String(err)}`;
  }
}
