// Carga do acervo de apólices em PDF (Drive → Workspace), de qualquer ramo,
// com vigência a partir de 2020 (pedido do Matheus, 23/10/2026). Estrutura e
// regras em supabase/schema_apolices_documentos.sql.
//
// Etapas (cada uma retoma de onde parou; nada é gravado até a última):
//   npx tsx scripts/apolices/carga-drive.ts listar   -- PDFs de apólice visíveis para a conta de serviço
//   npx tsx scripts/apolices/carga-drive.ts ler      -- baixa, guarda o texto e lê cada PDF
//   npx tsx scripts/apolices/carga-drive.ts casar    -- casa com o Corp e mostra a prévia (só leitura no banco)
//   npx tsx scripts/apolices/carga-drive.ts gravar   -- grava documentos, cofre e vínculos (só com o aval do Matheus)
//
// Casamento (qualquer ramo, sem depender do modelo do PDF): a apólice do Corp
// (emissão desde 2020) só é ligada ao PDF quando o texto traz as TRÊS coisas
// dela: o nº (inteiro ou como parte do nº do PDF), as datas de início e fim da vigência
// (±1 dia) e o CPF/CNPJ do cliente do Corp. Locatários, coberturas e local de
// risco lidos pelas regras fixas (leitores.ts) só existem para Seguro Fiança.
//
// Dados pessoais (texto dos PDFs, nomes, CPFs) ficam numa pasta temporária FORA
// do projeto (APOLICES_CACHE ou <tmp>/o2-apolices-fianca) até a gravação; apagar depois.
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { createServiceClient } from "@/lib/supabase/service";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { lerApolice, documento, type Leitura } from "./leitores";

const require = createRequire(import.meta.url);
const { cliente } = require("../base-unica/_google.cjs");

const CACHE = process.env.APOLICES_CACHE || path.join(os.tmpdir(), "o2-apolices-fianca");
const LEITURAS = path.join(CACHE, "leituras");
const TEXTOS = path.join(CACHE, "textos");
fs.mkdirSync(LEITURAS, { recursive: true });
fs.mkdirSync(TEXTOS, { recursive: true });
const arq = (n: string) => path.join(CACHE, n);
const lerJson = <T>(n: string, padrao: T): T => (fs.existsSync(arq(n)) ? JSON.parse(fs.readFileSync(arq(n), "utf8")) : padrao);
const salvarJson = (n: string, v: unknown) => fs.writeFileSync(arq(n), JSON.stringify(v));
const VERSAO_LEITURA = 3;

type Arquivo = { id: string; nome: string; pasta: string | null; criado: string; tamanho: number };
/** O que vale para qualquer ramo: candidatos a nº de apólice, datas e CPFs/CNPJs do texto. */
type Generico = { numeros: string[]; datas: string[]; documentos: string[] };
type Lido = { versao?: number; arquivo: Arquivo; leitura: Leitura | null; generico?: Generico; erro?: string; caracteres?: number };
type Situacao = "certa" | "conferir" | "sem_par" | "nao_lida";
type Casado = {
  arquivo: Arquivo;
  leitura: Leitura | null;
  situacao: Situacao;
  motivo: string | null;
  nosso_numero: string | null;
  corp: { seg: string; ramo: string; produto: string; ini: string; fim: string; numero: string; cliente: string } | null;
  candidatos?: { nn: string; numero: string; seg: string; ramo: string; ini: string; fim: string }[];
  garantidos_confirmados: boolean; // Fiança: segurado lido = cliente do Corp (aí os locatários lidos valem)
};

// ---------------- listar ----------------
async function listar() {
  const { drive } = cliente("GERAL");
  // Pelo nome ("apólice", qualquer ramo) e, na Fiança, também pelo texto
  // ("Fiança Locatícia"), porque há apólices salvas só com o nome do inquilino.
  const termos = ["apolice", "APOLICE", "Apolice", "apólice", "APÓLICE", "Apólice"];
  const desde = "createdTime >= '2019-10-01T00:00:00Z'"; // apólices com vigência desde 2020
  const consultas = [
    `mimeType='application/pdf' and trashed=false and ${desde} and (${termos.map((t) => `name contains '${t}'`).join(" or ")})`,
    `mimeType='application/pdf' and trashed=false and ${desde} and (fullText contains 'FIANÇA LOCATÍCIA' or fullText contains 'Fianca Locaticia')`,
  ];
  const todos = new Map<string, Arquivo>();
  for (const q of consultas) {
    let pageToken: string | undefined;
    do {
      const r = await drive.files.list({
        q, pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives",
        fields: "nextPageToken,files(id,name,parents,createdTime,size)",
      });
      for (const f of r.data.files ?? [])
        todos.set(f.id, { id: f.id, nome: f.name, pasta: f.parents?.[0] ?? null, criado: f.createdTime, tamanho: Number(f.size ?? 0) });
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  // Pelo nome, descarta o que claramente não é apólice (cartas de aprovação/recusa,
  // cotações, contratos, propostas...). Nome com "apólice" sempre fica.
  const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const NAO_APOLICE = /CARTA|APROVA|APROV\b|RECUSA|CONTRATO|BASICO|COMPLET|PROPOSTA|\bPROP\b|ORCAMENTO|COTACAO|PENDENCIA|FICHA|ANALISE|MINUTA|RELATORIO|ADITIVO|TAXA FIXA|\bLMI\b|CONDICOES|CONDICAO|BOLETO|PANORAMA|CALCULO|ENDOSSO|CANCELAMENTO|CLAUSULA|MANUAL|NOTIFICA|DECLARA|VISTORIA|LAUDO|RECIBO|PLANILHA/;
  const lista = [...todos.values()].filter((a) => /APOLICE/.test(sem(a.nome)) || !NAO_APOLICE.test(sem(a.nome)));
  salvarJson("lista.json", lista);
  const porAno: Record<string, number> = {};
  for (const a of lista) porAno[a.criado.slice(0, 4)] = (porAno[a.criado.slice(0, 4)] ?? 0) + 1;
  console.log(`PDFs na lista: ${lista.length} (descartados pelo nome — cartas, cotações, contratos...: ${todos.size - lista.length})`);
  console.log("por ano de criação do arquivo:", JSON.stringify(porAno));
}

// ---------------- ler ----------------
/** Candidatos a nº de apólice: cada sequência numérica (com . - / no meio), inteira,
 * em partes e os finais (o Corp guarda o fim do nº da Pottencial); sem zeros à esquerda. */
function generico(texto: string): Generico {
  const numeros = new Set<string>();
  const add = (s: string) => { const d = s.replace(/^0+/, ""); if (d.length >= 6 && d.length <= 20) numeros.add(d); };
  for (const m of texto.matchAll(/\d[\d.\-\/]*\d/g)) {
    const tok = m[0];
    const inteiro = tok.replace(/\D/g, "");
    if (inteiro.length > 30) continue;
    add(inteiro);
    for (const p of tok.split(/[.\-\/]/)) add(p);
    for (let i = 1; i <= inteiro.length - 6; i++) add(inteiro.slice(i));
  }
  const datas = new Set<string>();
  for (const m of texto.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)) datas.add(`${m[3]}-${m[2]}-${m[1]}`);
  const documentos = new Set<string>();
  for (const m of texto.matchAll(/\d{2,3}[.\d]*[\/\-]?[\d.\-\/]*\d/g)) { const d = documento(m[0]); if (d) documentos.add(d); }
  return { numeros: [...numeros], datas: [...datas], documentos: [...documentos] };
}

async function ler() {
  const lista = lerJson<Arquivo[]>("lista.json", []);
  if (!lista.length) throw new Error("rode 'listar' antes");
  const { drive } = cliente("GERAL");
  const pendentes = lista.filter((a) => {
    const f = path.join(LEITURAS, `${a.id}.json`);
    return !fs.existsSync(f) || (JSON.parse(fs.readFileSync(f, "utf8")) as Lido).versao !== VERSAO_LEITURA;
  });
  console.log(`a ler: ${pendentes.length} de ${lista.length}`);
  let feitos = 0;
  const trabalhar = async (a: Arquivo) => {
    let lido: Lido;
    try {
      const ft = path.join(TEXTOS, `${a.id}.txt.gz`);
      let texto: string;
      if (fs.existsSync(ft)) texto = zlib.gunzipSync(fs.readFileSync(ft)).toString("utf8");
      else {
        if (a.tamanho > 15_000_000) throw new Error("arquivo grande demais (>15 MB)");
        const r = await drive.files.get({ fileId: a.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
        texto = await extrairTextoPdf(Buffer.from(r.data as ArrayBuffer));
        fs.writeFileSync(ft, zlib.gzipSync(texto));
      }
      if (texto.length <= 50) lido = { versao: VERSAO_LEITURA, arquivo: a, leitura: null, erro: "PDF sem texto (provavelmente imagem/escaneado)", caracteres: texto.length };
      else lido = { versao: VERSAO_LEITURA, arquivo: a, leitura: lerApolice(texto), generico: generico(texto.slice(0, 40000)), caracteres: texto.length };
    } catch (e) {
      lido = { versao: VERSAO_LEITURA, arquivo: a, leitura: null, erro: (e as Error).message };
    }
    fs.writeFileSync(path.join(LEITURAS, `${a.id}.json`), JSON.stringify(lido));
    if (++feitos % 100 === 0) console.log(`  ${feitos}/${pendentes.length}`);
  };
  const fila = [...pendentes];
  await Promise.all(Array.from({ length: 6 }, async () => { while (fila.length) await trabalhar(fila.shift()!); }));
  console.log(`lidos: ${feitos}`);
}

// ---------------- casar ----------------
/** Cotação salva como se fosse apólice (ex.: "Essa é a sua cotação do seguro Pottencial"). */
const ehCotacao = (id: string) => {
  const ft = path.join(TEXTOS, `${id}.txt.gz`);
  if (!fs.existsSync(ft)) return false;
  const t = zlib.gunzipSync(fs.readFileSync(ft)).toString("utf8").slice(0, 6000);
  return /sua cota[çc][ãa]o|COTA[ÇC][ÃA]O DE SEGURO|COTA[ÇC][ÃA]O N[ºo°]/i.test(t) && !/N[ºo°] DA AP[ÓO]LICE|AP[ÓO]LICE N[ºo°]/i.test(t);
};
const emLotes = <T>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const maisDias = (iso: string, d: number) => new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10);
// Produto pelo ramo do Corp (mesmas chaves do painel de Sinistros).
const PRODUTO_DO_RAMO: Record<string, string> = {
  FIAN: "fianca", "2FIA": "fianca", CAP: "capitalizacao", CAP2: "capitalizacao", "2CAP": "capitalizacao", AUTO: "automovel",
  IMOB: "incendio", "2IMO": "incendio", RESI: "residencial", EMPR: "empresarial", COND: "condominio",
  VIND: "vida", VDCV: "vida", VGRP: "vida", PORT: "portateis", "2POR": "portateis", RC: "rc", RCP: "rc", VIAG: "viagem",
  CCOM: "conteudo", CRES: "conteudo",
};
const produtoDoRamo = (ramo: string) => PRODUTO_DO_RAMO[ramo] ?? "outros";

async function todasAsLinhas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function casar() {
  const sb = createServiceClient();
  const lidos = fs.readdirSync(LEITURAS).map((f) => JSON.parse(fs.readFileSync(path.join(LEITURAS, f), "utf8")) as Lido)
    .filter((l) => l.versao === VERSAO_LEITURA);
  console.log(`PDFs lidos: ${lidos.length}`);

  // Espelho do Corp: emissões (NOVO/RENV sem endosso) com vigência a partir de 2020, qualquer ramo.
  type Grade = { seg: string; ramo: string; numero_apolice: string; nosso_numero: number; numero_endosso: string | null; ini_vig: string; fim_vig: string };
  const grade = await todasAsLinhas<Grade>((de, ate) =>
    sb.from("corp_grade").select("seg,ramo,numero_apolice,nosso_numero,numero_endosso,ini_vig,fim_vig")
      .in("tipo", ["NOVO", "RENV"]).gte("ini_vig", "2020-01-01").not("numero_apolice", "is", null).order("id").range(de, ate));
  type Ap = { nn: string; seg: string; ramo: string; numero: string; ini: string; fim: string };
  const porNumero = new Map<string, Ap[]>();
  for (const g of grade) {
    if ((g.numero_endosso ?? "0").replace(/^0+/, "") !== "") continue;
    const dig = g.numero_apolice.replace(/\D/g, "").replace(/^0+/, "");
    if (dig.length < 6) continue; // nº curto / "0" (Pottencial antiga) nunca casa sozinho
    const ap = { nn: String(g.nosso_numero), seg: g.seg, ramo: g.ramo, numero: g.numero_apolice, ini: g.ini_vig, fim: g.fim_vig };
    const lista = porNumero.get(dig) ?? [];
    if (!lista.some((x) => x.nn === ap.nn)) lista.push(ap);
    porNumero.set(dig, lista);
  }
  console.log(`apólices do Corp (emissões desde 2020) no índice: ${new Set([...porNumero.values()].flat().map((a) => a.nn)).size}`);

  // Candidatas por PDF: nº presente + fim de vigência (±1 dia) presente no texto.
  const candidatas = new Map<string, Ap[]>();
  for (const l of lidos) {
    if (!l.generico) continue;
    const datas = new Set(l.generico.datas);
    const achadas = new Map<string, Ap>();
    for (const n of l.generico.numeros)
      for (const ap of porNumero.get(n) ?? [])
        // início E fim da vigência (±1 dia) no texto: evita ligar o PDF de uma renovação à
        // apólice anterior (que termina no dia em que a nova começa) quando a nova não está no Corp.
        if ([ap.ini, ap.fim].every((d) => datas.has(d) || datas.has(maisDias(d, 1)) || datas.has(maisDias(d, -1)))) achadas.set(ap.nn, ap);
    candidatas.set(l.arquivo.id, [...achadas.values()]);
  }

  // Cliente do Corp (CPF/CNPJ) de cada candidata: grade de produção do Corp (2025+) e cofre (anos anteriores).
  const nns = [...new Set([...candidatas.values()].flat().map((a) => a.nn))];
  const clientes = new Map<string, Set<string>>();
  const addCli = (nn: string, d: string | null | undefined) => { const doc = documento(d); if (doc) { if (!clientes.has(nn)) clientes.set(nn, new Set()); clientes.get(nn)!.add(doc); } };
  const nomeCliente = new Map<string, string>();
  for (const lote of emLotes(nns)) {
    const { data, error } = await sb.from("producao_erp").select("nosso_numero,cliente_cpf_cnpj,cliente_nome").in("nosso_numero", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) { addCli(String(x.nosso_numero), x.cliente_cpf_cnpj); const d = documento(x.cliente_cpf_cnpj); if (d && x.cliente_nome) nomeCliente.set(d, x.cliente_nome); }
  }
  const locDoNn = new Map<string, string[]>();
  for (const lote of emLotes(nns)) {
    const { data, error } = await sb.from("producao_unificada").select("origem_corp_numero,locatario_id").eq("fonte", "corp").in("origem_corp_numero", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) if (x.locatario_id) locDoNn.set(x.origem_corp_numero, [...(locDoNn.get(x.origem_corp_numero) ?? []), x.locatario_id]);
  }
  const docDoLoc = new Map<string, string | null>();
  for (const lote of emLotes([...new Set([...locDoNn.values()].flat())])) {
    const { data, error } = await sb.from("locatarios").select("id,cpf").in("id", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) docDoLoc.set(x.id, x.cpf);
  }
  for (const [nn, locs] of locDoNn) for (const id of locs) addCli(nn, docDoLoc.get(id));

  const casados: Casado[] = lidos.map((l) => {
    const r = l.leitura;
    const base = { arquivo: l.arquivo, leitura: r, nosso_numero: null, corp: null, garantidos_confirmados: false };
    if (!l.generico) return { ...base, situacao: "nao_lida", motivo: l.erro ?? "não lida" };
    const docsPdf = new Set(l.generico.documentos);
    const cands = candidatas.get(l.arquivo.id) ?? [];
    if (!cands.length) return { ...base, situacao: "sem_par", motivo: ehCotacao(l.arquivo.id) ? "cotação, não é apólice" : "nenhuma apólice do Corp desde 2020 com o mesmo nº, início e fim de vigência" };
    let comCliente = cands.filter((ap) => [...(clientes.get(ap.nn) ?? [])].some((d) => docsPdf.has(d)));
    // Renovação: o PDF novo cita o nº da apólice anterior ("renova apólice nº") e começa no dia
    // em que ela termina, então as duas batem. Desempate seguro: só a apólice deste PDF tem
    // também a data de INÍCIO no texto.
    if (comCliente.length > 1) {
      const datas = new Set(l.generico.datas);
      const comInicio = comCliente.filter((ap) => datas.has(ap.ini) || datas.has(maisDias(ap.ini, 1)) || datas.has(maisDias(ap.ini, -1)));
      if (comInicio.length === 1) comCliente = comInicio;
    }
    if (comCliente.length > 1) return { ...base, situacao: "conferir", motivo: `ambígua: ${comCliente.length} apólices do Corp`, candidatos: comCliente.map((a) => ({ nn: a.nn, numero: a.numero, seg: a.seg, ramo: a.ramo, ini: a.ini, fim: a.fim })) };
    if (!comCliente.length) {
      const semDoc = cands.every((ap) => !clientes.has(ap.nn));
      return { ...base, situacao: "conferir", motivo: semDoc ? "nº e vigência conferem, mas o cliente do Corp não tem CPF/CNPJ" : "nº e vigência conferem, mas o CPF/CNPJ do cliente do Corp não está no PDF" };
    }
    const ap = comCliente[0];
    const cli = [...clientes.get(ap.nn)!].find((d) => docsPdf.has(d))!;
    const corp = { seg: ap.seg, ramo: ap.ramo, produto: produtoDoRamo(ap.ramo), ini: ap.ini, fim: ap.fim, numero: ap.numero, cliente: cli };
    const garantidos_confirmados = corp.produto === "fianca" && !!r?.fianca && r.segurado?.documento === cli && r.garantidos.length > 0;
    return { ...base, situacao: "certa", motivo: null, nosso_numero: ap.nn, corp, garantidos_confirmados };
  });
  salvarJson("casamento.json", casados);
  salvarJson("nomes-clientes.json", Object.fromEntries(nomeCliente));

  // ---------- prévia ----------
  const certas = casados.filter((c) => c.situacao === "certa");
  const porProduto: Record<string, Record<string, number>> = {};
  for (const c of certas) {
    porProduto[c.corp!.produto] ??= {};
    porProduto[c.corp!.produto][c.corp!.seg] = (porProduto[c.corp!.produto][c.corp!.seg] ?? 0) + 1;
  }
  const sit: Record<string, number> = {};
  for (const c of casados) sit[c.situacao] = (sit[c.situacao] ?? 0) + 1;
  console.log("\nPRÉVIA (nada gravado)");
  console.log("situação dos PDFs:", JSON.stringify(sit));
  console.log("PDFs certos por produto e seguradora:");
  console.table(porProduto);
  const nnsCertos = new Set(certas.map((c) => c.nosso_numero!));
  const porProdutoNn: Record<string, Set<string>> = {};
  for (const c of certas) (porProdutoNn[c.corp!.produto] ??= new Set()).add(c.nosso_numero!);
  console.log("apólices do Corp distintas ligadas a PDF:", nnsCertos.size, JSON.stringify(Object.fromEntries(Object.entries(porProdutoNn).map(([k, v]) => [k, v.size]))));
  const fiancaOk = certas.filter((c) => c.garantidos_confirmados);
  const docsGar = new Set(fiancaOk.flatMap((c) => c.leitura!.garantidos.map((g) => g.documento)));
  const existentes = new Set<string>();
  for (const lote of emLotes([...docsGar])) {
    const { data } = await sb.from("locatarios").select("cpf").in("cpf", lote);
    for (const x of data ?? []) existentes.add(x.cpf);
  }
  console.log(`Fiança com locatários confirmados: ${fiancaOk.length} PDFs | locatários distintos: ${docsGar.size} (já no cofre: ${existentes.size}, novos: ${docsGar.size - existentes.size})`);
  console.log(`Fiança certas sem locatários aproveitáveis (segurado lido ≠ cliente do Corp ou modelo não lido): ${certas.filter((c) => c.corp!.produto === "fianca" && !c.garantidos_confirmados).length}`);
  let sin = 0;
  const nnsFiancaOk = [...new Set(fiancaOk.map((c) => c.nosso_numero!))];
  for (const lote of emLotes(nnsFiancaOk)) {
    const { count } = await sb.from("sinistros_corp").select("id", { count: "exact", head: true }).in("nosso_numero", lote);
    sin += count ?? 0;
  }
  let sinTodos = 0;
  for (const lote of emLotes([...nnsCertos])) {
    const { count } = await sb.from("sinistros_corp").select("id", { count: "exact", head: true }).in("nosso_numero", lote);
    sinTodos += count ?? 0;
  }
  console.log(`sinistros do Corp em apólices ligadas a PDF: ${sinTodos} (com locatário confirmado: ${sin})`);
  const motivos: Record<string, number> = {};
  for (const c of casados) if (c.situacao !== "certa" && c.motivo) { const k = `${c.situacao}: ${c.motivo.replace(/\d+ apólices/, "N apólices")}`; motivos[k] = (motivos[k] ?? 0) + 1; }
  console.log("\nmotivos fora de 'certa':");
  for (const [m, n] of Object.entries(motivos).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n} × ${m.slice(0, 160)}`);
  console.log(`\n(simulação — nada gravado; arquivos de trabalho em ${CACHE})`);
}

// ---------------- gravar ----------------
const normNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

async function gravar() {
  const sb = createServiceClient();
  const casados = lerJson<Casado[]>("casamento.json", []);
  const nomesCorp = new Map(Object.entries(lerJson<Record<string, string>>("nomes-clientes.json", {})));
  if (!casados.length) throw new Error("rode 'casar' antes");
  const certas = casados.filter((c) => c.situacao === "certa");

  // 1. Cofre: cliente do Corp de cada apólice certa + locatários confirmados da Fiança
  //    (não sobrescreve quem já existe; só marca a fonte "apolice_pdf").
  const pessoas = new Map<string, string | null>();
  const quer = (d: string, nome: string | null | undefined) => { if (!pessoas.get(d)) pessoas.set(d, nome ?? null); };
  for (const c of certas) {
    const r = c.leitura;
    quer(c.corp!.cliente, (r?.segurado?.documento === c.corp!.cliente ? r.segurado.nome : null) ?? nomesCorp.get(c.corp!.cliente));
    if (c.garantidos_confirmados) for (const g of r!.garantidos) quer(g.documento, g.nome);
  }
  const idPorDoc = new Map<string, string>();
  const fontesPorId = new Map<string, string[]>();
  for (const lote of emLotes([...pessoas.keys()])) {
    const { data, error } = await sb.from("locatarios").select("id,cpf,fontes").in("cpf", lote);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) { idPorDoc.set(x.cpf, x.id); fontesPorId.set(x.id, x.fontes ?? []); }
  }
  const novos = [...pessoas].filter(([d]) => !idPorDoc.has(d)).map(([d, nome]) => ({
    cpf: d, nome, nome_normalizado: nome ? normNome(nome) : null, tipo_documento: d.length === 11 ? "cpf" : "cnpj",
    identificacao: "documento", primeira_fonte: "apolice_pdf", fontes: ["apolice_pdf"],
  }));
  for (const lote of emLotes(novos, 500)) {
    const { data, error } = await sb.from("locatarios").insert(lote).select("id,cpf");
    if (error) throw new Error(error.message);
    for (const x of data ?? []) idPorDoc.set(x.cpf, x.id);
  }
  let marcados = 0;
  for (const [id, fontes] of fontesPorId) if (!fontes.includes("apolice_pdf")) {
    const { error } = await sb.from("locatarios").update({ fontes: [...fontes, "apolice_pdf"] }).eq("id", id);
    if (error) throw new Error(error.message);
    marcados++;
  }

  // 2. Documentos (todos, com a situação; nenhum dado pessoal aqui).
  const fianca = (c: Casado) => c.corp?.produto === "fianca" || (!c.corp && c.leitura?.fianca);
  const linhas = casados.map((c) => {
    const r = c.leitura;
    const usaLeitura = c.garantidos_confirmados; // campos lidos (local, coberturas, estipulante) só na Fiança confirmada
    return {
      fonte: "drive", arquivo_id: c.arquivo.id, arquivo_nome: c.arquivo.nome, arquivo_pasta_id: c.arquivo.pasta, arquivo_criado_em: c.arquivo.criado,
      produto: c.corp?.produto ?? (fianca(c) ? "fianca" : "nao_identificado"), seguradora: c.corp?.seg ?? r?.seguradora ?? null,
      numero_apolice: c.corp?.numero ?? r?.numero ?? null, ramo: c.corp?.ramo ?? r?.ramo ?? null,
      vigencia_inicio: c.corp?.ini ?? r?.vigencia_inicio ?? null, vigencia_fim: c.corp?.fim ?? r?.vigencia_fim ?? null, emitida_em: r?.emitida_em ?? null,
      limite_maximo_garantia: usaLeitura ? r!.limite_maximo_garantia : null, coberturas: usaLeitura ? r!.coberturas : [],
      local_risco: usaLeitura && r!.local_risco ? { texto: r!.local_risco } : {},
      estipulante_nome: usaLeitura ? r!.estipulante_nome : null, estipulante_documento: usaLeitura ? r!.estipulante_documento : null,
      nosso_numero: c.nosso_numero, regra_casamento: c.situacao === "certa" ? "numero_vigencia_cliente" : null,
      situacao: c.situacao, motivo: c.motivo, gravado_em: new Date().toISOString(),
    };
  });
  const idDoc = new Map<string, string>();
  for (const lote of emLotes(linhas, 300)) {
    const { data, error } = await sb.from("apolice_documentos").upsert(lote, { onConflict: "arquivo_id" }).select("id,arquivo_id");
    if (error) throw new Error(error.message);
    for (const x of data ?? []) idDoc.set(x.arquivo_id, x.id);
  }

  // 3. Vínculos pessoa ↔ apólice (só nas certas): cliente do Corp como segurado; locatários só na Fiança confirmada.
  const partes = certas.flatMap((c) => {
    const documento_id = idDoc.get(c.arquivo.id)!;
    return [
      { documento_id, nosso_numero: c.nosso_numero, papel: "segurado", ordem: 1, locatario_id: idPorDoc.get(c.corp!.cliente)! },
      ...(c.garantidos_confirmados ? c.leitura!.garantidos.map((g, i) => ({ documento_id, nosso_numero: c.nosso_numero, papel: "garantido", ordem: i + 1, locatario_id: idPorDoc.get(g.documento)! })) : []),
    ];
  });
  for (const lote of emLotes([...new Set(partes.map((p) => p.documento_id))], 300)) {
    const { error } = await sb.from("apolice_partes").delete().in("documento_id", lote);
    if (error) throw new Error(error.message);
  }
  for (const lote of emLotes(partes, 500)) {
    const { error } = await sb.from("apolice_partes").insert(lote);
    if (error) throw new Error(error.message);
  }
  console.log(`gravado: ${linhas.length} documentos (${certas.length} ligados a apólice do Corp) | ${partes.length} vínculos | cofre: ${novos.length} pessoas novas, ${marcados} existentes marcadas com a fonte "apolice_pdf"`);
  console.log(`apague a pasta de trabalho com dados pessoais quando terminar: ${CACHE}`);
}

const etapa = process.argv[2];
const etapas: Record<string, () => Promise<void>> = { listar, ler, casar, gravar };
if (!etapas[etapa]) {
  console.log("uso: npx tsx scripts/apolices/carga-drive.ts listar|ler|casar|gravar");
  process.exit(1);
}
etapas[etapa]().catch((e) => {
  console.error(e);
  process.exit(1);
});
