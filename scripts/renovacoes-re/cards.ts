// Robô de renovações RE — cards do funil Renovações (SPA 1046, categoria 34).
// Regras do Matheus (23/10/2026, prompt + respostas):
//  - Incêndio Imobiliário (IMOB e 2IMO): 1 card por imobiliária + seguradora,
//    título "RENOVAÇÃO - [IMOBILIÁRIA] - [SEGURADORA] - MM.AAAA". Itens que a
//    imobiliária renova pela Segimob (multicálculo terceirizado, não é
//    seguradora) levam Origem = Segimob e seguradora "SEG/<SEGURADORA>" — por
//    isso ficam em card separado dos itens diretos da mesma imobiliária.
//    A imobiliária é sempre a real (o outro produtor da apólice).
//  - Residencial, Empresarial e Condomínio: 1 card por apólice. Só O2 Corretora
//    (venda direta, sem imobiliária) → "RENOVAÇÃO - [RAMO] - [SEGURADO] - MM.AAAA".
//  - Todos: competência operacional = 1º dia do mês, Tipo de processo =
//    Renovação, etapa "Entrada e conferência", quantidade de endereços = nº de
//    linhas, fim de vigência = a menor do grupo, comissão = o MENOR % do lote,
//    repasse em branco, "Prêmio total" (atual) em branco para o cotador e a soma
//    do prêmio do ano anterior no campo "Prêmio total anterior". Card de 1 item
//    leva o endereço nos campos LOGRADOURO/NUMERO/COMPLEMENTO/BAIRRO/CEP.
//    Observações: quantidade de itens, linhas da planilha do lote, link no Drive
//    e os alertas dos itens. Item ativo = o Corp só traz o que está vigente.
// Padrão da equipe (88 cards de novembro criados à mão pela Kamila em 23/10/2026):
// responsável Kamila, Origem "Ficha" nos diretos e "Segimob" nos da Segimob,
// todas as apólices no campo Número da apólice ("; "), observações "Quantidade
// de itens / Linhas da planilha / Planilha: link", empresa sempre vinculada,
// título individual "RENOVAÇÃO - RESI - [SEGURADO] - [IMOB] - MM.AAAA".
// As linhas do Imobiliário vêm das planilhas de lote já geradas (planilhas.ts) e
// enviadas ao Drive — as mesmas que a equipe vai trabalhar.
// uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/cards.ts --mes 2026-12 \
//     --corp <Simplificado com Produtor.xlsx> --pdf <Itens e Garantias.pdf> [--itens <Exporta itens pacote.xlsx>] [--lotes <pasta>]
//   → grava a prévia (xlsx) e os cards (json) em renovacoes-re/cards/<mes>/. Nada vai ao Bitrix.
//   ... --criar   cria no Bitrix os cards do json (só a partir de 26/10/2026, autorização do Matheus).
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { drive as criarDrive } from "@googleapis/drive";
import { obterAutenticacaoGoogle } from "@/lib/googleAuth";
import { buscarDefinicaoCampos, listarItensSpaCategoria } from "@/lib/bitrix/client";
import { createServiceClient } from "@/lib/supabase/service";
import { lerExportItens } from "@/lib/renovacoesRe/exportItens";
import { lerPdfItensGarantias, separarEndereco } from "@/lib/renovacoesRe/pdfItensGarantias";
import { lerSimplificadoComProdutor, nomeSeguradora, type ApoliceCorp } from "@/lib/renovacoesRe/planilhaLote";

const ENTITY = 1046;
const CATEGORIA = 34;
const ETAPA = "DT1046_34:NEW";
const LIBERADO_EM = "2026-10-26"; // Matheus: incluir os cards só na segunda, 26/10/2026

const args = process.argv.slice(2);
const op = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const mes = op("--mes");
if (!mes) throw new Error("informe --mes AAAA-MM");
const mesBr = `${mes.slice(5, 7)}.${mes.slice(0, 4)}`;
const RAIZ = path.resolve(process.cwd(), "..", "renovacoes-re");
const pastaCards = path.join(RAIZ, "cards", mes);
const arqJson = path.join(pastaCards, `cards-${mes}.json`);

const PRODUTO: Record<string, string> = {
  IMOB: "Incêndio Imobiliário", "2IMO": "Incêndio Imobiliário",
  RESI: "Incêndio Individual Residencial", EMPR: "Incêndio Individual Empresarial", COND: "Condomínio",
};
const RAMO_TITULO: Record<string, string> = { RESI: "RESI", EMPR: "EMPR", COND: "COND" };
// Nome da seguradora no Corp → opção do campo "Seguradora final (seleção)".
const SEG_CAMPO: Record<string, string> = { YELUM: "YELLUM", SULAMERICA: "SULAMERICA" };
const segCampo = (s: string) => SEG_CAMPO[s] ?? s;

export type Card = {
  chave: string;
  titulo: string;
  produto: string;
  ramos: string;
  imobiliaria: string | null;
  seguradora: string; // opção do campo (TOKIO, SEG/TOKIO, YELLUM…)
  origem: string; // "Segimob" ou "Ficha"
  itens: number;
  fimVigencia: string; // AAAA-MM-DD (a menor)
  comissaoPct: number | null; // o menor do lote
  premioAnterior: number;
  endereco: { logradouro: string; numero: string; complemento: string; bairroCidade: string; cep: string } | null;
  planilha: string | null;
  linhas: string | null;
  linkDrive: string | null;
  observacoes: string;
  companyId: number | null;
  empresa: string | null;
  alertas: string[];
  apolices: string[];
  responsavelId: number | null;
  bitrixId?: number;
};

const texto = (v: unknown) => String(v ?? "").trim();
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nomeArquivo = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
// "2, 3, 4, 7" → "2–4, 7"
function intervalos(ns: number[]) {
  const o = [...ns].sort((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < o.length; ) {
    let j = i;
    while (j + 1 < o.length && o[j + 1] === o[j] + 1) j++;
    partes.push(i === j ? `${o[i]}` : `${o[i]} a ${o[j]}`);
    i = j + 1;
  }
  return partes.join(", ");
}

async function linksDrive(): Promise<Map<string, string>> {
  const drive = criarDrive({ version: "v3", auth: obterAutenticacaoGoogle(["https://www.googleapis.com/auth/drive.readonly"]) });
  const comum = { supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives" as const };
  const p = await drive.files.list({ ...comum, q: `name = 'PLANILHAS DE REN ${mesBr}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: "files(id)" });
  const pasta = p.data.files?.[0]?.id;
  const mapa = new Map<string, string>();
  if (!pasta) return mapa;
  let pageToken: string | undefined;
  do {
    const r = await drive.files.list({ ...comum, q: `'${pasta}' in parents and trashed = false`, fields: "nextPageToken, files(name, webViewLink)", pageSize: 1000, pageToken });
    for (const f of r.data.files ?? []) if (f.name && f.webViewLink) mapa.set(f.name, f.webViewLink);
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken);
  return mapa;
}

// Empresa do card: produtor do Corp → ficha da base única (vínculo confirmado)
// → empresa do Bitrix ligada à mesma ficha (vínculo confirmado).
async function empresasPorProdutor(produtores: string[]) {
  const sb = createServiceClient();
  const { data: corp } = await sb.from("imobiliaria_registros_fonte").select("nome_original, imobiliaria_id")
    .eq("fonte", "corp_produtor").eq("situacao", "confirmado").in("nome_original", produtores);
  const fichaPorProdutor = new Map((corp ?? []).filter((r) => r.imobiliaria_id).map((r) => [texto(r.nome_original), r.imobiliaria_id as string]));
  const fichas = [...new Set(fichaPorProdutor.values())];
  const { data: bx } = fichas.length
    ? await sb.from("imobiliaria_registros_fonte").select("chave_externa, nome_original, imobiliaria_id")
        .eq("fonte", "bitrix_empresa").eq("situacao", "confirmado").in("imobiliaria_id", fichas)
    : { data: [] };
  const empresaPorFicha = new Map<string, { id: number; nome: string }>();
  for (const r of bx ?? []) if (!empresaPorFicha.has(r.imobiliaria_id)) empresaPorFicha.set(r.imobiliaria_id, { id: Number(r.chave_externa), nome: texto(r.nome_original) });
  return (produtor: string) => {
    const f = fichaPorProdutor.get(produtor);
    return f ? (empresaPorFicha.get(f) ?? null) : null;
  };
}

async function montar() {
  const corp = lerSimplificadoComProdutor(fs.readFileSync(op("--corp")!)).filter((a) => (a.fimVigencia ?? "").startsWith(mes!) && a.ramoCodigo in PRODUTO);
  const pdf = op("--pdf") ? await lerPdfItensGarantias(new Uint8Array(fs.readFileSync(op("--pdf")!))) : [];
  const pdfPorNN = new Map(pdf.map((d) => [d.nossoNumero, d]));
  const exportItens = op("--itens") ? lerExportItens(fs.readFileSync(op("--itens")!)) : [];
  const kamilaPorNN = new Map(exportItens.map((i) => [i.nossoNumero, i]));
  const pastaLotes = op("--lotes") ?? path.join(RAIZ, "planilhas", mes!);
  const drive = await linksDrive();
  const empresa = await empresasPorProdutor([...new Set(corp.flatMap((a) => a.produtores))]);
  const existentes = await listarItensSpaCategoria(ENTITY, CATEGORIA);
  const chaveNome = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const empresaPorTitulo = new Map<string, number>();
  for (const i of existentes) {
    const m = texto(i.title).match(/^RENOVA[ÇC][ÃA]O\s*-\s*(.+?)\s*-\s*(?:(?:SEG\/)?(?:TOKIO|PORTO|YELL?UM|ALLIANZ|ZURICH|ALFA|BRADESCO)\s*-\s*)?\d{2}\.\d{4}\s*$/i);
    if (m && i.companyId && !/^(RESI|EMPR|COND|VIND|VGRP|VDCV)\b/i.test(m[1])) empresaPorTitulo.set(chaveNome(m[1]), Number(i.companyId));
  }
  const { buscarEmpresas } = await import("@/lib/bitrix/client");
  const nomesEmpresas = await buscarEmpresas([...new Set(empresaPorTitulo.values())]);
  const empresaDe = (a: ApoliceCorp) => {
    const pelaBase = a.produtores.map(empresa).find(Boolean);
    if (pelaBase) return pelaBase;
    const id = a.imobiliaria ? empresaPorTitulo.get(chaveNome(a.imobiliaria)) : undefined;
    return id ? { id, nome: nomesEmpresas[id] ?? `empresa #${id}` } : null;
  };
  // Responsável = quem é responsável pelos cards de renovação mais recentes (Kamila).
  const kamila = [...existentes].sort((a, b) => texto(b.createdTime).localeCompare(texto(a.createdTime)))[0]?.assignedById ?? null;

  const alertasDe = (a: ApoliceCorp) => {
    const al: string[] = [];
    const k = kamilaPorNN.get(a.nossoNumero);
    if (k?.renovadoNoCorp) al.push(`apólice ${a.apolice} já consta como renovada no Corp`);
    if (/INATIVO/i.test(a.imobiliaria ?? "")) al.push("imobiliária marcada INATIVO no Corp");
    if (a.inicioVigencia && a.fimVigencia && (Date.parse(a.fimVigencia) - Date.parse(a.inicioVigencia)) / 864e5 < 300)
      al.push(`apólice ${a.apolice} com vigência curta (${dataBr(a.inicioVigencia)} a ${dataBr(a.fimVigencia)})`);
    return al;
  };

  const cards: Card[] = [];
  const usadas = new Set<string>();
  const minPct = (aps: ApoliceCorp[]) => {
    const v = aps.map((a) => a.percentualComissao).filter((x) => x > 0);
    return v.length ? Math.min(...v) : null;
  };

  // ---- Incêndio Imobiliário: pelas planilhas de lote (mesma ordem de linhas do Drive)
  const imobCorp = corp.filter((a) => a.ramoCodigo === "IMOB" || a.ramoCodigo === "2IMO");
  const porApolice = new Map<string, ApoliceCorp[]>();
  for (const a of imobCorp) porApolice.set(`${a.apolice}|${a.documento}`, [...(porApolice.get(`${a.apolice}|${a.documento}`) ?? []), a]);
  for (const arq of fs.readdirSync(pastaLotes).filter((f) => f.endsWith(".xlsx") && !f.startsWith("_"))) {
    const nomePlanilha = arq.replace(/\.xlsx$/, "");
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.readFile(path.join(pastaLotes, arq)).Sheets["Página1"], { defval: "" });
    const grupos = new Map<string, { aps: ApoliceCorp[]; linhas: number[]; obs: string[]; end: Record<string, string> }>();
    linhas.forEach((l, i) => {
      const lista = porApolice.get(`${texto(l["APÓLICE"])}|${texto(l["CPF / CNPJ"])}`) ?? [];
      const a = lista.find((x) => !usadas.has(x.nossoNumero));
      if (!a) throw new Error(`${arq} linha ${i + 2}: apólice ${texto(l["APÓLICE"])} não achada no Corp`);
      usadas.add(a.nossoNumero);
      const segimob = a.canais.some((c) => /SEGIMOB/i.test(c));
      const seg = segCampo(nomeSeguradora(a.seguradoraCodigo));
      const chave = `${a.imobiliaria}|${segimob ? `SEG/${seg}` : seg}`;
      const g = grupos.get(chave) ?? { aps: [], linhas: [], obs: [], end: {} };
      g.aps.push(a);
      g.linhas.push(i + 2);
      if (texto(l.OBS)) g.obs.push(texto(l.OBS));
      g.end = { logradouro: texto(l["ENDEREÇO"]), numero: texto(l["Nº"]), complemento: texto(l.COMPLEMENTO), bairroCidade: texto(l.BAIRRO), cep: texto(l.CEP) };
      grupos.set(chave, g);
    });
    for (const [chave, g] of grupos) {
      const [imob, seg] = chave.split("|");
      const segimob = seg.startsWith("SEG/");
      const link = drive.get(nomePlanilha) ?? null;
      const lmiConferir = g.obs.filter((o) => /LMI a conferir/.test(o)).length;
      const conferirUnidade = g.obs.filter((o) => /conferir unidade/.test(o)).length;
      const alertas = [...new Set(g.aps.flatMap(alertasDe))];
      const premio = Math.round(g.aps.reduce((s, a) => s + a.premioTotal, 0) * 100) / 100;
      const emp = empresaDe(g.aps[0]);
      const obs = [
        `Quantidade de itens: ${g.aps.length}`,
        `Linhas da planilha: ${intervalos(g.linhas)}`,
        `Planilha: ${link ?? `${nomePlanilha} (link no Drive não encontrado)`}`,
        segimob ? "Itens renovados pela imobiliária no sistema da Segimob." : "",
        `Prêmio total do ano anterior: ${reais(premio)}.`,
        lmiConferir ? `LMI a conferir em ${lmiConferir} ${lmiConferir === 1 ? "item" : "itens"}.` : "",
        conferirUnidade ? `${conferirUnidade} ${conferirUnidade === 1 ? "item com LMI achado por aproximação" : "itens com LMI achado por aproximação"} — conferir unidade.` : "",
        ...alertas.map((a) => `Atenção: ${a}.`),
        emp ? "" : "Empresa do Bitrix não identificada pelo cadastro único — vincular à mão.",
      ].filter(Boolean).join("\n");
      cards.push({
        chave: `${imob}|${seg}`,
        titulo: `RENOVAÇÃO - ${imob} - ${seg} - ${mesBr}`,
        produto: PRODUTO.IMOB,
        ramos: [...new Set(g.aps.map((a) => a.ramoCodigo))].join(", "),
        imobiliaria: imob,
        seguradora: seg,
        origem: segimob ? "Segimob" : "Ficha",
        itens: g.aps.length,
        fimVigencia: g.aps.map((a) => a.fimVigencia!).sort()[0],
        comissaoPct: minPct(g.aps),
        premioAnterior: premio,
        endereco: g.aps.length === 1 ? g.end as Card["endereco"] : null,
        planilha: nomePlanilha,
        linhas: intervalos(g.linhas),
        linkDrive: link,
        observacoes: obs,
        companyId: emp?.id ?? null,
        empresa: emp?.nome ?? null,
        alertas,
        apolices: g.aps.map((a) => a.apolice),
        responsavelId: kamila,
      });
    }
  }
  const sobrou = imobCorp.filter((a) => !usadas.has(a.nossoNumero));
  if (sobrou.length) throw new Error(`${sobrou.length} apólices de Imobiliário do Corp não estão em nenhuma planilha de lote (rode planilhas.ts de novo)`);

  // ---- Residencial, Empresarial e Condomínio: 1 card por apólice
  for (const a of corp.filter((x) => !(x.ramoCodigo === "IMOB" || x.ramoCodigo === "2IMO"))) {
    const d = pdfPorNN.get(a.nossoNumero);
    const e = separarEndereco(d?.enderecoRisco ?? null);
    const segimob = a.canais.some((c) => /SEGIMOB/i.test(c));
    const seg0 = segCampo(nomeSeguradora(a.seguradoraCodigo));
    const seg = segimob ? `SEG/${seg0}` : seg0;
    const ramo = RAMO_TITULO[a.ramoCodigo];
    const emp = a.imobiliaria ? empresaDe(a) : null;
    const alertas = alertasDe(a);
    const titulo = a.imobiliaria ? `RENOVAÇÃO - ${ramo} - ${a.cliente} - ${a.imobiliaria} - ${mesBr}` : `RENOVAÇÃO - ${ramo} - ${a.cliente} - ${mesBr}`;
    cards.push({
      chave: `${a.nossoNumero}`,
      titulo,
      produto: PRODUTO[a.ramoCodigo],
      ramos: a.ramoCodigo,
      imobiliaria: a.imobiliaria,
      seguradora: seg,
      origem: segimob ? "Segimob" : "Ficha",
      itens: 1,
      fimVigencia: a.fimVigencia!,
      comissaoPct: a.percentualComissao || null,
      premioAnterior: a.premioTotal,
      endereco: { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairroCidade: [e.bairro, d?.cidadeUf].filter(Boolean).join(" / "), cep: "" },
      planilha: null,
      linhas: null,
      linkDrive: null,
      observacoes: [
        "Quantidade de itens: 1",
        `Apólice ${a.apolice} (${a.ramoCodigo}).`,
        a.imobiliaria ? "" : a.canais.length ? `Sem imobiliária no Corp (só ${a.canais.join("/")}).` : "Venda direta O2 (sem imobiliária).",
        segimob ? "Renovado pela imobiliária no sistema da Segimob." : "",
        `Prêmio total do ano anterior: ${reais(a.premioTotal)}.`,
        d?.enderecoRisco ? "Endereço lido do PDF do Corp (bairro pode vir abreviado, sem CEP)." : "Endereço não encontrado no Corp — preencher.",
        ...alertas.map((x) => `Atenção: ${x}.`),
        a.imobiliaria && !emp ? "Empresa do Bitrix não identificada pelo cadastro único — vincular à mão." : "",
      ].filter(Boolean).join("\n"),
      companyId: emp?.id ?? null,
      empresa: emp?.nome ?? null,
      alertas,
      apolices: [a.apolice],
      responsavelId: kamila,
    });
  }

  // ---- já existe no funil?
  const titulos = new Set(existentes.map((i) => texto(i.title).toUpperCase()));
  const apolicesBitrix = new Set(existentes.map((i) => texto(i["ufCrm12NumApolice"])).filter(Boolean));
  for (const c of cards) {
    if (titulos.has(c.titulo.toUpperCase())) c.alertas.push("JÁ EXISTE card com este título no funil Renovações");
    if (c.apolices.some((ap) => apolicesBitrix.has(ap))) c.alertas.push("apólice já está em card do funil Renovações");
  }
  return { cards, existentes: existentes.length, corp: corp.length };
}

function gravarPrevia(cards: Card[]) {
  fs.mkdirSync(pastaCards, { recursive: true });
  const linhas = cards.map((c, i) => ({
    "#": i + 1,
    Título: c.titulo,
    Produto: c.produto,
    "Ramos (Corp)": c.ramos,
    Imobiliária: c.imobiliaria ?? "— venda direta O2 —",
    "Empresa no Bitrix": c.empresa ?? "(vincular à mão)",
    "Seguradora final": c.seguradora,
    Origem: c.origem,
    "Número da apólice": c.apolices.join("; "),
    "Qtd. endereços": c.itens,
    "Fim de vigência": dataBr(c.fimVigencia),
    "Comissão (%)": c.comissaoPct ?? "",
    "Repasse (%)": "",
    "Prêmio total (atual)": "",
    "Prêmio total anterior": c.premioAnterior,
    "Competência operacional": `01/${mesBr.replace(".", "/")}`,
    "Tipo de processo": "Renovação",
    Etapa: "Entrada e conferência",
    LOGRADOURO: c.endereco?.logradouro ?? "",
    NUMERO: c.endereco?.numero ?? "",
    COMPLEMENTO: c.endereco?.complemento ?? "",
    "BAIRRO/CIDADE": c.endereco?.bairroCidade ?? "",
    CEP: c.endereco?.cep ?? "",
    "Referência da planilha": c.planilha ?? "",
    "Linhas da planilha": c.linhas ?? "",
    "Link no Drive": c.linkDrive ?? "",
    Observações: c.observacoes,
    Alertas: c.alertas.join("; "),
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws["!cols"] = Object.keys(linhas[0]).map((k) => ({ wch: k === "Título" ? 60 : k === "Observações" ? 80 : Math.max(k.length + 2, 12) }));
  ws["!autofilter"] = { ref: ws["!ref"]! };
  XLSX.utils.book_append_sheet(wb, ws, "Cards");
  const arq = path.join(pastaCards, `PREVIA CARDS RENOVAÇÃO ${mesBr}.xlsx`);
  XLSX.writeFile(wb, arq);
  fs.writeFileSync(arqJson, JSON.stringify(cards, null, 1));
  return arq;
}

// ---------------------------------------------------------------- criação
async function bitrixPost<T>(metodo: string, corpo: unknown): Promise<T> {
  const base = process.env.BITRIX_WEBHOOK_URL!.replace(/\/?$/, "/");
  for (let t = 0; ; t++) {
    const r = await fetch(`${base}${metodo}.json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = (await r.json()) as { result?: T; error?: string; error_description?: string };
    if (j.error === "QUERY_LIMIT_EXCEEDED" && t < 5) { await new Promise((s) => setTimeout(s, 1500 * (t + 1))); continue; }
    if (j.error || !r.ok) throw new Error(`${metodo}: ${j.error_description ?? j.error ?? r.status}`);
    return j.result as T;
  }
}

async function criar() {
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  if (hoje < LIBERADO_EM) throw new Error(`criação liberada só a partir de ${dataBr(LIBERADO_EM)} (pedido do Matheus)`);
  const cards = JSON.parse(fs.readFileSync(arqJson, "utf8")) as Card[];
  const defs = await buscarDefinicaoCampos(ENTITY);
  const opcao = (campo: string, valor: string) => {
    const it = defs[campo]?.items?.find((i) => i.VALUE.toUpperCase() === valor.toUpperCase());
    if (!it) throw new Error(`opção "${valor}" não existe no campo ${campo}`);
    return Number(it.ID);
  };
  const campoAnterior = Object.entries(defs).find(([, d]) => /pr[eê]mio total anterior/i.test((d as { title?: string }).title ?? ""))?.[0];
  if (!campoAnterior) throw new Error('falta criar no Bitrix o campo "Prêmio total anterior" (Monetário) na SPA Produção Incêndio');
  const bloqueados = cards.filter((c) => !c.bitrixId && c.alertas.some((a) => /JÁ EXISTE|já está em card/.test(a)));
  if (bloqueados.length) throw new Error(`${bloqueados.length} card(s) já existem no funil — revise a prévia antes de criar`);
  let criados = 0;
  for (const c of cards) {
    if (c.bitrixId) continue;
    const arqPlanilha = c.planilha ? path.join(RAIZ, "planilhas", mes!, `${nomeArquivo(c.planilha)}.xlsx`) : null;
    const fields: Record<string, unknown> = {
      title: c.titulo,
      categoryId: CATEGORIA,
      stageId: ETAPA,
      ...(c.companyId ? { companyId: c.companyId } : {}),
      ufCrm12TipoProcesso: opcao("ufCrm12TipoProcesso", "Renovação"),
      ufCrm12Produto: opcao("ufCrm12Produto", c.produto),
      ufCrm12SeguradoraFinalMulti: [opcao("ufCrm12SeguradoraFinalMulti", c.seguradora)],
      ufCrm12OrigemProducao: opcao("ufCrm12OrigemProducao", c.origem),
      ...(c.responsavelId ? { assignedById: c.responsavelId } : {}),
      ufCrm12CompetenciaOperacional: `${mes}-01`,
      ufCrm12FimVigencia: c.fimVigencia,
      ufCrm12QtdEnderecos: c.itens,
      ...(c.comissaoPct != null ? { ufCrm12_1788368973918: c.comissaoPct } : {}),
      [campoAnterior]: `${c.premioAnterior}|BRL`,
      ufCrm12Observacoes: c.observacoes,
      ...(c.planilha ? { ufCrm12ReferenciaPlanilha: c.planilha } : {}),
      ufCrm12NumApolice: c.apolices.join("; "),
      ...(c.endereco
        ? {
            ufCrm12_1790085424526: c.endereco.logradouro,
            ufCrm12_1790085444491: c.endereco.numero,
            ufCrm12_1790085448344: c.endereco.complemento,
            ufCrm12_1790085451655: c.endereco.bairroCidade,
            ufCrm12_1790085456047: c.endereco.cep,
          }
        : {}),
      ...(arqPlanilha && fs.existsSync(arqPlanilha)
        ? { ufCrm12PlanilhaItens: [path.basename(arqPlanilha), fs.readFileSync(arqPlanilha).toString("base64")] }
        : {}),
    };
    const r = await bitrixPost<{ item: { id: number } }>("crm.item.add", { entityTypeId: ENTITY, fields });
    c.bitrixId = r.item.id;
    criados++;
    fs.writeFileSync(arqJson, JSON.stringify(cards, null, 1)); // grava a cada card: pode retomar sem duplicar
    console.log(`criado #${c.bitrixId}: ${c.titulo}`);
  }
  console.log(`pronto: ${criados} cards criados`);
}

async function main() {
  if (args.includes("--criar")) return criar();
  if (!op("--corp")) throw new Error("informe --corp <Simplificado com Produtor.xlsx>");
  const { cards, existentes, corp } = await montar();
  const arq = gravarPrevia(cards);
  const n = (f: (c: Card) => boolean) => cards.filter(f).length;
  console.log(`${mes}: ${corp} apólices no Corp → ${cards.length} cards (funil Renovações tem hoje ${existentes} cards)`);
  console.log(`Imobiliário ${n((c) => c.produto === PRODUTO.IMOB)} | Residencial ${n((c) => c.produto === PRODUTO.RESI)} | Empresarial ${n((c) => c.produto === PRODUTO.EMPR)} | Condomínio ${n((c) => c.produto === PRODUTO.COND)}`);
  console.log(`Segimob ${n((c) => c.origem === "Segimob")} | venda direta O2 ${n((c) => !c.imobiliaria)} | 1 item ${n((c) => c.itens === 1)} | sem empresa no Bitrix ${n((c) => !!c.imobiliaria && !c.companyId)} | com alerta ${n((c) => c.alertas.length > 0)} | sem link do Drive ${n((c) => !!c.planilha && !c.linkDrive)}`);
  console.log(`prêmio do ano anterior: ${reais(cards.reduce((s, c) => s + c.premioAnterior, 0))}`);
  console.log(`prévia: ${arq}\n(nada foi criado no Bitrix)`);
}
main().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
