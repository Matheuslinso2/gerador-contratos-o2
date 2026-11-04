process.loadEnvFile(".env.local");
// Lê o texto nativo (sem IA, sem OCR) dos PDFs de apólice das apólices VIGENTES ainda não lidas e grava os campos estruturados
// em erp_apolice_pdf_campos (nível 1, sem texto bruto). Confere nº da apólice, vigência e CPF/CNPJ contra o documento.
// Parcelas lidas vão para erp_apolice_parcelas_pdf só quando o documento confere. Divergência/sem texto = lista, nada é alterado no ERP.
// Uso: tsx scripts/erp/ler-apolices-vigentes-pdf.ts [ABREV] [--reler-sem-quadro] [--limite N]
import fs from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha } from "@/lib/pdfComSenha";
import { textoDoPdf } from "@/lib/erp/anexosEmail";

const sb = createServiceClient();
// --ocr-jsonl <arq>: texto lido por OCR LOCAL do Windows (scripts/erp/ocr-pdf-win.ps1) dos PDFs sem texto; chave = documento_id no nome do arquivo
const OCR_ARQ = process.argv.includes("--ocr-jsonl") ? process.argv[process.argv.indexOf("--ocr-jsonl") + 1] : null;
const OCR = new Map<string, string>();
if (OCR_ARQ) for (const l of fs.readFileSync(OCR_ARQ, "utf8").split("\n")) { if (!l.trim()) continue; try { const o = JSON.parse(l) as { arq: string; paginas?: { texto: string }[] }; const id = /__([0-9a-f-]{36})\.pdf/.exec(o.arq)?.[1]; if (id && o.paginas) OCR.set(id, o.paginas.map((p) => p.texto).join("\n")); } catch { /* linha inválida */ } }
const LOTE = "PDF-VIGENTES-" + new Date().toISOString().slice(0, 10);
const LEITOR_VERSAO = "v2-2026-11-02";
type P = { n: number; venc: string; valor?: number | null };
const iso = (d: string) => d.split("/").reverse().join("-");
const vlr = (s: string) => { const c = s.replace(/R\$\s?/, ""); return /,\d{2}$/.test(c) ? Number(c.replace(/\./g, "").replace(",", ".")) : Number(c.replace(/,/g, "")); }; // 1.234,56 (BR) ou 1,234.56 (Tokio Fiança)
// layouts alternativos (v2): tenta o parser principal e, se não achar quadro, estes
const ALT: Record<string, ((t: string) => P[])[]> = {
  TOKIO: [
    (t) => [...t.matchAll(/(?:Ap[oó]lice|Endosso) (\d{2}) ([\d.]+,\d{2}) (\d{2}\/\d{2}\/\d{4})/g)].map((m) => ({ n: +m[1], venc: iso(m[3]), valor: vlr(m[2]) })),
    (t) => [...t.matchAll(/\b(\d{2}) (\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}) (\d{2}\/\d{2}\/\d{4}) (?:Ficha|Boleto|D[eé]bito|Cart[aã]o|Fatura)/g)].map((m) => ({ n: +m[1], venc: iso(m[3]), valor: vlr(m[2]) })),
  ],
  PORTO: [
    (t) => [...t.matchAll(/\b(\d{1,2}) R\$ ([\d.]+,\d{2}) (\d{2}\/\d{2}\/\d{4}) /g)].map((m) => ({ n: +m[1], venc: iso(m[3]), valor: vlr(m[2]) })),
  ],
  ALLIANZ: [
    (t) => { const i = t.search(/Parc\. Vencimento Valor/i); const f = i < 0 ? "" : t.slice(i, i + 900); const j = f.search(/Total a Pagar/i); return [...(j > 0 ? f.slice(0, j) : f).matchAll(/\b(\d{1,2}) (\d{2}\/\d{2}\/\d{4}) (?:R\$ )?([\d.]+,\d{2})/g)].map((m) => ({ n: +m[1], venc: iso(m[2]), valor: vlr(m[3]) })); },
  ],
};
// Pottencial: o PDF traz forma, nº de parcelas e valor, sem datas (os vencimentos vêm das faturas)
function pagamentoSemDatas(t: string): { forma: string; qtd: number; valor: number } | null {
  const m = /Pagamento: (.{3,60}?) em (\d{1,2}) ?x (?:sem|com) juros: R\$ ?([\d.]+,\d{2})/i.exec(t);
  return m ? { forma: m[1].trim(), qtd: +m[2], valor: vlr(m[3]) } : null;
}
const MAPA_CHAVE: Record<string, string> = { PORT: "PORTO", TOKI: "TOKIO", TOO: "TOO", ALLI: "ALLIANZ", YELU: "YELUM", POTT: "POTTENCIAL" };
const PARSERS: Record<string, (t: string) => P[]> = {
  PORTO: (t) => {
    const i = t.search(/PARCELAMENTO DO SEGURO/i); const s = i >= 0 ? t.slice(i, i + 1500) : "";
    const a = [...s.matchAll(/\b(\d{2}) R\$ [\d.]+,\d{2} (\d{2}\/\d{2}\/\d{4})/g)].map((m) => ({ n: +m[1], venc: iso(m[2]) }));
    if (a.length) return a;
    const pv = t.match(/Primeiro vencimento (\d{2})\/(\d{2})\/(\d{4})/i); const nx = t.match(/(?:Fatura|Cart[aã]o|D[eé]bito)[^]{0,40}?(\d{1,2})\s?X/i);
    if (!pv) return [];
    const total = nx ? +nx[1] : 1; const out: P[] = [];
    for (let k = 0; k < total; k++) { const d = new Date(Date.UTC(+pv[3], +pv[2] - 1 + k, 1)); const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); out.push({ n: k + 1, venc: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(+pv[1], ult)).padStart(2, "0")}` }); }
    return out;
  },
  TOKIO: (t) => [...t.matchAll(/\b(\d{2})ª\s+[\d.]+,\d{2}\s+(\d{2}\/\d{2}\/\d{4})/g)].map((m) => ({ n: +m[1], venc: iso(m[2]) })),
  TOO: (t) => [...t.matchAll(/\b(\d{1,2}) (?:[\d.]+,\d{2} ){4,5}[\d.]+,\d{2} (\d{2}\/\d{2}\/\d{4})/g)].map((m) => ({ n: +m[1], venc: iso(m[2]) })),
  ALLIANZ: (t) => [...t.matchAll(/\b(\d{1,2}) (\d{2}\/\d{2}\/\d{4}) R\$ [\d.]+,\d{2}/g)].map((m) => ({ n: +m[1], venc: iso(m[2]) })),
  YELUM: (t) => [...t.matchAll(/\b(\d{4}) (\d{2}\/\d{2}\/\d{4}) [\d.]+,\d{2}/g)].map((m) => ({ n: +m[1], venc: iso(m[2]) })),
  POTTENCIAL: (t) => [...t.matchAll(/\b(\d{1,2})\s*(?:\/\s*\d{1,2})?\s+(\d{2}\/\d{2}\/\d{4})\s+R?\$?\s*[\d.]+,\d{2}/g)].map((m) => ({ n: +m[1], venc: iso(m[2]) })),
};
const num = (s?: string) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);
const dig = (s: string) => s.replace(/\D/g, "");

// Apólice anterior: cada seguradora escreve de um jeito (Pottencial "Nº DA APÓLICE RENOVADA", Allianz "Nº Apólice anterior:"); o resto cai no padrão genérico.
function extrairCamposExtras(t: string): { anterior: string | null; tipo: string | null; proposta: string | null; pares: Record<string, string> } {
  const ant = /N[ºo°]?\s*(?:DA\s*)?AP[ÓO]LICE\s+RENOVADA\s*:?\s*([0-9A-Z][0-9A-Z.\/-]{5,40})/i.exec(t)?.[1]
    ?? /N[ºo°]?\s*Ap[óo]lice\s+anterior\s*:?\s*([0-9A-Z][0-9A-Z.\/ -]{5,40}?)(?=\s+[A-ZÀ-Ú]{3,}|\s{2,}|$)/i.exec(t)?.[1]
    ?? /Ap[óo]lice\s+(?:anterior|renovada|substitu[ií]da)\s*:?\s*([0-9A-Z][0-9A-Z.\/-]{5,40})/i.exec(t)?.[1] ?? null;
  const tipo = /TIPO\s+DE\s+SEGURO\s*:?\s*(Renova[çc][ãa]o|Novo|Seguro Novo|Endosso)/i.exec(t)?.[1] ?? null;
  const proposta = /N[ºo°]?\s*DA\s+PROPOSTA\s*:?\s*(\d{4,})/i.exec(t)?.[1] ?? null;
  const pares: Record<string, string> = {};
  for (const m of t.matchAll(/([A-ZÀ-Ú][A-Za-zÀ-ú0-9 ./ºª()-]{2,40}?):\s*([^:]{1,80}?)(?=\s+[A-ZÀ-Ú][A-Za-zÀ-ú0-9 ./ºª()-]{2,40}?:|\s{2,}|$)/g)) {
    const k = m[1].trim(); if (k.length >= 3 && !(k in pares) && Object.keys(pares).length < 150) pares[k] = m[2].trim().slice(0, 80);
  }
  return { anterior: ant ? ant.replace(/\s+/g, " ").trim() : null, tipo, proposta, pares };
}
const alnum = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");
// Liga a renovação pelo número escrito no PDF (prova documental, nível 1). Compara por igualdade ou por final do número (o PDF traz prefixo de filial/ramo).
async function ligarAnteriorPeloPdf(docId: string, extra: { anterior: string | null }, avisos: string[]) {
  if (!extra.anterior) { await sb.from("erp_documentos").update({ renovacao_lida_em: new Date().toISOString() }).eq("id", docId).is("renovacao_lida_em", null); return; }
  const a = alnum(extra.anterior); if (a.length < 7) return;
  const final = a.slice(-9);
  const { data: cand } = await sb.from("erp_documentos").select("id,numero_apolice").eq("tipo", "A").neq("id", docId).neq("situacao", "duplicado").ilike("numero_apolice", `%${final.slice(-6)}%`).limit(40);
  const achados = (cand ?? []).filter((c) => { const n = alnum(String(c.numero_apolice ?? "")); return n.length >= 7 && (n === a || a.endsWith(n) || n.endsWith(a)); });
  if (achados.length !== 1) { avisos.push(achados.length ? `apólice anterior ${extra.anterior} casa com ${achados.length} documentos` : `apólice anterior ${extra.anterior} não encontrada no ERP`); await sb.from("erp_apolice_pdf_campos").update({ avisos }).eq("documento_id", docId); return; }
  const { data: atual } = await sb.from("erp_documentos").select("documento_renovado_id").eq("id", docId).maybeSingle();
  if (atual?.documento_renovado_id && atual.documento_renovado_id !== achados[0].id) { avisos.push(`PDF cita a anterior ${extra.anterior}, mas o ERP liga a outro documento`); await sb.from("erp_apolice_pdf_campos").update({ avisos }).eq("documento_id", docId); return; }
  await sb.from("erp_documentos").update({ documento_renovado_id: achados[0].id, renovacao_fonte: "apolice_pdf", renovacao_nivel: 1, renovacao_lida_em: new Date().toISOString() }).eq("id", docId);
}

type Doc = { id: string; numero_apolice: string | null; vigencia_inicio: string | null; vigencia_fim: string | null; nosso_numero_corp: number | null; seguradora_id: string; abrev: string; imobiliaria_principal_id: string | null; locatario_id: string | null };

async function carregarDocs(filtro: string | undefined, reler: boolean): Promise<{ doc: Doc; origem: "erp" | "corp"; bucket: string; path: string }[]> {
  const { data: segs } = await sb.from("erp_seguradoras").select("id,abreviacao");
  const abrev = new Map((segs ?? []).map((s) => [s.id as string, s.abreviacao as string]));
  const docs: Doc[] = [];
  for (let off = 0; ; off += 1000) {
    // --todas (03/11/2026, Matheus: "todas as apólices ainda não lidas devem ser lidas"): vigentes, vencidas e canceladas, não só as vigentes
    let q = sb.from("erp_documentos").select("id,numero_apolice,vigencia_inicio,vigencia_fim,nosso_numero_corp,seguradora_id,imobiliaria_principal_id,locatario_id").eq("tipo", "A");
    q = process.argv.includes("--todas") ? q.in("situacao", ["vigente", "vencido", "cancelado"]) : q.eq("situacao", "vigente");
    const { data } = await q.order("id").range(off, off + 999);
    if (!data?.length) break;
    for (const d of data) docs.push({ ...(d as unknown as Doc), abrev: abrev.get(d.seguradora_id as string) ?? "?" });
    if (data.length < 1000) break;
  }
  const lidos = new Map<string, string>();
  for (let off = 0; ; off += 1000) { const { data } = await sb.from("erp_apolice_pdf_leitura").select("documento_id,situacao").order("documento_id").range(off, off + 999); if (!data?.length) break; data.forEach((x) => lidos.set(x.documento_id as string, x.situacao as string)); if (data.length < 1000) break; }
  const jaCampos = new Map<string, string>();
  for (let off = 0; ; off += 1000) { const { data } = await sb.from("erp_apolice_pdf_campos").select("documento_id,situacao").order("documento_id").range(off, off + 999); if (!data?.length) break; data.forEach((x) => jaCampos.set(x.documento_id as string, x.situacao as string)); if (data.length < 1000) break; }
  // padrão: só o que ainda não tem campos; --refazer: também tudo que não ficou 'lido' (sem_quadro, divergente, inválido, sem texto)
  const refazer = process.argv.includes("--refazer");
  // a leitura antiga de parcelas (erp_apolice_pdf_leitura 'lido') não guardou os demais campos: o que decide é existir (ou não) a linha em erp_apolice_pdf_campos
  // --docs NN,NN (Nosso nº do Corp): relê esses documentos mesmo já lidos (leitor melhorado)
  const forcar = process.argv.includes("--docs") ? new Set(process.argv[process.argv.indexOf("--docs") + 1].split(",").map(Number)) : null;
  // --desde AAAA-MM-DD (03/11/2026, Matheus: ler 100% do documento, inclusive a apólice anterior): relê as apólices com início de vigência a partir da data, mesmo já lidas
  const desde = process.argv.includes("--desde") ? process.argv[process.argv.indexOf("--desde") + 1] : null;
  const pend = docs.filter((d) => desde ? !!d.vigencia_inicio && d.vigencia_inicio >= desde : forcar ? !!d.nosso_numero_corp && forcar.has(d.nosso_numero_corp) : (!filtro || d.abrev === filtro) && (!jaCampos.has(d.id) || (refazer && jaCampos.get(d.id) !== "lido")));
  const alvo = reler ? pend.filter((d) => lidos.get(d.id) === "sem_quadro" || !lidos.has(d.id)) : pend;
  // PDFs: ERP (tipo apolice) primeiro; senão Corp (rótulo Apólice/Certificado)
  const erpAx = new Map<string, string>();
  const ids = alvo.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 200) { const { data } = await sb.from("erp_documento_anexos").select("documento_id,storage_path").eq("tipo", "apolice").in("documento_id", ids.slice(i, i + 200)); for (const a of data ?? []) if (!erpAx.has(a.documento_id as string)) erpAx.set(a.documento_id as string, a.storage_path as string); }
  const { data: tipos } = await sb.from("corp_anexos_tipos").select("rotulo_id,tipo");
  const rotApol = new Set((tipos ?? []).filter((t) => t.tipo === "Apólice" || t.tipo === "Certificado").map((t) => t.rotulo_id as string));
  const corpAx = new Map<string, string>();
  const nossos = alvo.filter((d) => !erpAx.has(d.id) && d.nosso_numero_corp).map((d) => d.nosso_numero_corp as number);
  for (let i = 0; i < nossos.length; i += 150) { const { data } = await sb.from("corp_anexos").select("nosso_numero,storage_path,rotulo_id,mime,apolice").in("nosso_numero", nossos.slice(i, i + 150)); for (const a of data ?? []) if ((a.apolice === true || rotApol.has(a.rotulo_id as string)) && String(a.mime ?? "").includes("pdf") && !corpAx.has(String(a.nosso_numero))) corpAx.set(String(a.nosso_numero), a.storage_path as string); }
  const out: { doc: Doc; origem: "erp" | "corp"; bucket: string; path: string }[] = [];
  for (const d of alvo) {
    if (erpAx.has(d.id)) out.push({ doc: d, origem: "erp", bucket: "anexos-documentos", path: erpAx.get(d.id)! });
    else if (d.nosso_numero_corp && corpAx.has(String(d.nosso_numero_corp))) out.push({ doc: d, origem: "corp", bucket: "corp-anexos", path: corpAx.get(String(d.nosso_numero_corp))! });
  }
  return out;
}

async function main() {
  const filtro = process.argv.slice(2).find((a, k, arr) => !a.startsWith("--") && arr[k - 1] !== "--limite" && arr[k - 1] !== "--ocr-jsonl");
  const reler = process.argv.includes("--reler-sem-quadro");
  const li = process.argv.indexOf("--limite"); const limite = li > 0 ? +process.argv[li + 1] : Infinity;
  const t0 = Date.now();
  let lista = await carregarDocs(filtro, reler);
  if (OCR_ARQ) lista = lista.filter((it) => OCR.has(it.doc.id));
  if (isFinite(limite)) lista = lista.slice(0, limite);
  console.log("a ler:", lista.length, "| lote", LOTE);
  const stat: Record<string, { lido: number; divergente: number; sem_texto: number; sem_quadro: number; invalido: number; erro: number }> = {};
  let i = 0;
  const trabalhar = async (it: (typeof lista)[number]) => {
    const { doc } = it; const s = (stat[doc.abrev] ??= { lido: 0, divergente: 0, sem_texto: 0, sem_quadro: 0, invalido: 0, erro: 0 });
    let t: string;
    // texto já extraído antes (Matheus 04/11/2026: ler o PDF uma vez só): reaproveita, sem baixar de novo
    const { data: guardado } = await sb.from("erp_apolice_pdf_texto").select("texto").eq("documento_id", doc.id).eq("fonte_pdf", `${it.origem}:${it.path}`).maybeSingle();
    if (guardado?.texto) t = guardado.texto;
    else if (OCR.has(doc.id)) t = OCR.get(doc.id)!.replace(/\s+/g, " ");
    else {
      const { data } = await sb.storage.from(it.bucket).download(it.path);
      if (!data) { s.erro++; return; }
      const buf = Buffer.from(await data.arrayBuffer());
      const r = await abrirTextoPdfComSenha(buf, []);
      t = (r?.texto ?? "").replace(/\s+/g, " ");
      if (t.length < 200) {
        // PDF protegido (Tokio: senha = início do CPF do segurado): tenta com os CPFs das partes do documento
        const cpfs: string[] = [];
        if (doc.locatario_id) { const { data: l } = await sb.from("locatarios").select("cpf").eq("id", doc.locatario_id).maybeSingle(); if (l?.cpf) cpfs.push(String(l.cpf)); }
        const { data: pa } = await sb.from("erp_doc_partes_acervo").select("locatario:locatarios(cpf)").eq("documento_id", doc.id);
        for (const p of (pa ?? []) as unknown as { locatario: { cpf: string | null } | null }[]) if (p.locatario?.cpf) cpfs.push(p.locatario.cpf);
        const r2 = await textoDoPdf(buf, [...new Set(cpfs.map((c) => c.replace(/\D/g, "")).filter((c) => c.length >= 11))]);
        if (r2.t && r2.t.length > t.length) t = r2.t.replace(/\s+/g, " ");
      }
    }
    const chave = MAPA_CHAVE[doc.abrev] ?? doc.abrev;
    if (!guardado?.texto && t.length >= 200) await sb.from("erp_apolice_pdf_texto").upsert({ documento_id: doc.id, seguradora_chave: chave, texto: t, metodo: OCR.has(doc.id) ? "ocr_windows" : "texto_nativo", fonte_pdf: `${it.origem}:${it.path}`, tipo_anexo: "apolice", leitor_versao: LEITOR_VERSAO }, { onConflict: "documento_id,fonte_pdf" });
    const base = { documento_id: doc.id, seguradora_id: doc.seguradora_id, seguradora_chave: chave, fonte_pdf: `${it.origem}:${it.path}`, lote: LOTE, imobiliaria_id: doc.imobiliaria_principal_id, locatario_id: doc.locatario_id };
    if (t.length < 200) { s.sem_texto++; await sb.from("erp_apolice_pdf_campos").upsert({ ...base, situacao: "sem_texto", divergencias: ["PDF sem texto nativo (imagem)"] }); await sb.from("erp_apolice_pdf_leitura").upsert({ documento_id: doc.id, seguradora_chave: chave, situacao: "sem_texto", parcelas_lidas: 0 }); return; }
    const datas = [...new Set([...t.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`))].filter((d) => +d.slice(0, 4) >= 2000 && +d.slice(0, 4) <= 2040).sort();
    const docs = [...new Set([...t.matchAll(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g)].map((m) => dig(m[0])))];
    const premioTotal = num(t.match(/Pr[eê]mio\s+Total[^\d]{0,40}([\d.]+,\d{2})/i)?.[1]); const premioLiq = num(t.match(/Pr[eê]mio\s+L[ií]quido[^\d]{0,40}([\d.]+,\d{2})/i)?.[1]); const iof = num(t.match(/\bI\.?\s?O\.?\s?F\.?[^\d]{0,30}([\d.]+,\d{2})/i)?.[1]);
    const formaTokio = /Cobran[çc]a:\s*Ficha/i.test(t) ? "Fatura" : null; // Tokio Fiança: "Cobrança: Ficha Faturada" = fatura mensal da imobiliária
    const forma = formaTokio ?? t.match(/\b(Cart[aã]o de Cr[eé]dito|D[eé]bito em Conta|Boleto(?: Banc[aá]rio)?|Fatura|Carn[eê]|Cart[aã]o)\b/i)?.[1] ?? null;
    const apNum = doc.numero_apolice ? dig(doc.numero_apolice) : "";
    const confereAp = apNum.length >= 4 ? dig(t).includes(apNum) : null;
    // texto da vigência da apólice (Tokio): vale mais que a data mais antiga solta no PDF
    const vigExpl = t.match(/Vig[eê]ncia:\s*a partir das 24 horas do dia (\d{2})\/(\d{2})\/(\d{4}) at[eé] [àa]s 24 horas do dia (\d{2})\/(\d{2})\/(\d{4})/i);
    const vigIni = vigExpl ? `${vigExpl[3]}-${vigExpl[2]}-${vigExpl[1]}` : (datas[0] ?? null);
    const vigFim = vigExpl ? `${vigExpl[6]}-${vigExpl[5]}-${vigExpl[4]}` : (datas.length ? datas[datas.length - 1] : null);
    const confereVig = doc.vigencia_inicio ? (vigExpl ? vigIni === doc.vigencia_inicio : datas.includes(doc.vigencia_inicio)) : null; const avisos: string[] = []; if (confereVig && doc.vigencia_fim && !datas.includes(doc.vigencia_fim)) avisos.push("fim da vigência do documento não aparece no PDF");
    let confereDoc: boolean | null = null; let alvoDocs: string[] = [];
    { const { data: pa } = await sb.from("apolice_partes").select("locatarios:locatario_id(cpf)").eq("documento_id", doc.id); alvoDocs = (pa ?? []).map((p) => dig(String((p as unknown as { locatarios: { cpf: string | null } | null }).locatarios?.cpf ?? ""))).filter((x) => x.length >= 11); if (!alvoDocs.length && doc.locatario_id) { const { data: l } = await sb.from("locatarios").select("cpf").eq("id", doc.locatario_id).maybeSingle(); const c = dig(String(l?.cpf ?? "")); if (c.length >= 11) alvoDocs = [c]; } if (alvoDocs.length && docs.length) confereDoc = alvoDocs.some((c) => docs.includes(c)); }
    const div: string[] = [];
    if (confereAp === false) div.push("nº da apólice não aparece no PDF");
    // OCR erra datas e dígitos: a identidade vem do nº da apólice; vigência/CPF não localizados no OCR viram aviso, não divergência
    if (confereVig === false) { if (OCR.has(doc.id) && confereAp) avisos.push("vigência do documento não localizada no texto do OCR"); else div.push(vigExpl ? `vigência do documento (${doc.vigencia_inicio}) difere da do PDF (${vigIni} a ${vigFim})` : "vigência do documento não aparece no PDF"); }
    if (confereDoc === false) { if (confereAp && (confereVig || OCR.has(doc.id))) avisos.push("CPF/CNPJ do documento não localizado entre os do PDF (nº e vigência conferem)"); else div.push("CPF/CNPJ do documento não aparece no PDF"); }
    const parser = PARSERS[chave] as (typeof PARSERS)[string] | undefined;
    let bruto: P[] = parser ? parser(t) : [];
    const alternativas = ALT[chave] ?? [];
    const valida = (b: P[]) => { const m = new Map<number, string>(); for (const p of b) if (!m.has(p.n)) m.set(p.n, p.venc); const k = [...m.keys()].sort((a, c) => a - c); return k.length > 0 && k.every((n, x) => n === x + 1) && k.every((n, x) => x === 0 || m.get(n)! > m.get(k[x - 1])!) && k.length <= 60; };
    if (!bruto.length || !valida(bruto)) for (const alt of alternativas) { const b = alt(t); if (b.length && valida(b)) { bruto = b; break; } }
    const porN = new Map<number, string>(); const valorN = new Map<number, number | null>(); for (const p of bruto) if (!porN.has(p.n)) { porN.set(p.n, p.venc); valorN.set(p.n, p.valor ?? null); }
    const ns = [...porN.keys()].sort((a, b) => a - b);
    const seqOk = ns.length > 0 && ns.every((n, k) => n === k + 1) && ns.every((n, k) => k === 0 || porN.get(n)! > porN.get(ns[k - 1])!) && ns.length <= 60;
    const semDatas = chave === "POTTENCIAL" && !ns.length ? pagamentoSemDatas(t) : null;
    let situacao: string;
    if (div.length) situacao = "divergente"; else if (semDatas) situacao = "lido"; else if (OCR.has(doc.id) && confereAp && !ns.length) { situacao = "lido"; avisos.push("lido por OCR: quadro de parcelas não reconhecido no texto do OCR"); } else if (parser && !ns.length) situacao = "sem_quadro"; else if (parser && !seqOk) situacao = "invalido"; else situacao = "lido";
    s[situacao as keyof typeof s]++;
    let parcelas: unknown = seqOk ? ns.map((n) => ({ n, vencimento: porN.get(n), valor: valorN.get(n) ?? null })) : null;
    let formaFinal = forma;
    if (semDatas) { parcelas = Array.from({ length: semDatas.qtd }, (_, k) => ({ n: k + 1, vencimento: null, valor: semDatas.valor })); formaFinal = semDatas.forma; avisos.push("PDF sem datas de vencimento (pagamento por fatura mensal); vencimentos vêm das faturas"); }
    await sb.from("erp_apolice_pdf_campos").upsert({ ...base, situacao, numero_apolice_pdf: confereAp ? doc.numero_apolice : null, vigencia_ini_pdf: vigIni, vigencia_fim_pdf: vigFim, datas_no_pdf: datas.slice(0, 40), cpf_cnpj_pdf: docs.slice(0, 10), premio_total_pdf: premioTotal, premio_liquido_pdf: premioLiq, iof_pdf: iof, forma_pagamento_pdf: formaFinal, qtd_parcelas_pdf: ns.length || semDatas?.qtd || null, parcelas, fonte: `PDF da apólice (${OCR.has(doc.id) ? "OCR local do Windows" : "texto nativo"}) · leitor ${LEITOR_VERSAO}`, confere_apolice: confereAp, confere_vigencia: confereVig, confere_documento: confereDoc, divergencias: div.length ? div : null, avisos: avisos.length ? avisos : null });
    // campos de renovação e demais pares rótulo:valor, lidos uma vez só (sem texto bruto)
    const extra = extrairCamposExtras(t);
    await sb.from("erp_apolice_pdf_campos").update({ apolice_anterior_pdf: extra.anterior, tipo_seguro_pdf: extra.tipo, proposta_pdf: extra.proposta, campos_pdf: extra.pares }).eq("documento_id", doc.id);
    await ligarAnteriorPeloPdf(doc.id, extra, avisos);
    await sb.from("erp_apolice_pdf_leitura").upsert({ documento_id: doc.id, seguradora_chave: chave, situacao, parcelas_lidas: ns.length });
    if (situacao === "lido" && parcelas) await sb.from("erp_apolice_parcelas_pdf").upsert(ns.map((n) => ({ documento_id: doc.id, n, vencimento_pdf: porN.get(n)!, seguradora_chave: chave, anexo_path: it.path })));
  };
  const worker = async () => { while (i < lista.length) { const d = lista[i++]; try { await trabalhar(d); } catch (e) { (stat[d.doc.abrev] ??= { lido: 0, divergente: 0, sem_texto: 0, sem_quadro: 0, invalido: 0, erro: 0 }).erro++; console.log("erro", d.doc.id, String(e).slice(0, 90)); } if (i % 100 === 0) console.log(i, "/", lista.length, JSON.stringify(stat)); } };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  console.log("FIM em", Math.round((Date.now() - t0) / 1000), "s");
  console.table(stat);
}
main().catch((e) => { console.error("ERRO", e); process.exit(1); });
