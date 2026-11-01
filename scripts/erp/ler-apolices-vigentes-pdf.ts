process.loadEnvFile(".env.local");
// Lê o texto nativo (sem IA, sem OCR) dos PDFs de apólice das apólices VIGENTES ainda não lidas e grava os campos estruturados
// em erp_apolice_pdf_campos (nível 1, sem texto bruto). Confere nº da apólice, vigência e CPF/CNPJ contra o documento.
// Parcelas lidas vão para erp_apolice_parcelas_pdf só quando o documento confere. Divergência/sem texto = lista, nada é alterado no ERP.
// Uso: tsx scripts/erp/ler-apolices-vigentes-pdf.ts [ABREV] [--reler-sem-quadro] [--limite N]
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha } from "@/lib/pdfComSenha";

const sb = createServiceClient();
const LOTE = "PDF-VIGENTES-" + new Date().toISOString().slice(0, 10);
type P = { n: number; venc: string };
const iso = (d: string) => d.split("/").reverse().join("-");
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

type Doc = { id: string; numero_apolice: string | null; vigencia_inicio: string | null; vigencia_fim: string | null; nosso_numero_corp: number | null; seguradora_id: string; abrev: string; imobiliaria_principal_id: string | null; locatario_id: string | null };

async function carregarDocs(filtro: string | undefined, reler: boolean): Promise<{ doc: Doc; origem: "erp" | "corp"; bucket: string; path: string }[]> {
  const { data: segs } = await sb.from("erp_seguradoras").select("id,abreviacao");
  const abrev = new Map((segs ?? []).map((s) => [s.id as string, s.abreviacao as string]));
  const docs: Doc[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from("erp_documentos").select("id,numero_apolice,vigencia_inicio,vigencia_fim,nosso_numero_corp,seguradora_id,imobiliaria_principal_id,locatario_id").eq("situacao", "vigente").eq("tipo", "A").order("id").range(off, off + 999);
    if (!data?.length) break;
    for (const d of data) docs.push({ ...(d as unknown as Doc), abrev: abrev.get(d.seguradora_id as string) ?? "?" });
    if (data.length < 1000) break;
  }
  const lidos = new Map<string, string>();
  for (let off = 0; ; off += 1000) { const { data } = await sb.from("erp_apolice_pdf_leitura").select("documento_id,situacao").order("documento_id").range(off, off + 999); if (!data?.length) break; data.forEach((x) => lidos.set(x.documento_id as string, x.situacao as string)); if (data.length < 1000) break; }
  const jaCampos = new Set<string>();
  for (let off = 0; ; off += 1000) { const { data } = await sb.from("erp_apolice_pdf_campos").select("documento_id").order("documento_id").range(off, off + 999); if (!data?.length) break; data.forEach((x) => jaCampos.add(x.documento_id as string)); if (data.length < 1000) break; }
  const pend = docs.filter((d) => (!filtro || d.abrev === filtro) && !jaCampos.has(d.id) && (lidos.get(d.id) !== "lido") && (reler || lidos.get(d.id) !== "sem_quadro" || true));
  const alvo = reler ? pend.filter((d) => lidos.get(d.id) === "sem_quadro" || !lidos.has(d.id)) : pend;
  // PDFs: ERP (tipo apolice) primeiro; senão Corp (rótulo Apólice/Certificado)
  const erpAx = new Map<string, string>();
  const ids = alvo.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 200) { const { data } = await sb.from("erp_documento_anexos").select("documento_id,storage_path").eq("tipo", "apolice").in("documento_id", ids.slice(i, i + 200)); for (const a of data ?? []) if (!erpAx.has(a.documento_id as string)) erpAx.set(a.documento_id as string, a.storage_path as string); }
  const { data: tipos } = await sb.from("corp_anexos_tipos").select("rotulo_id,tipo");
  const rotApol = new Set((tipos ?? []).filter((t) => t.tipo === "Apólice" || t.tipo === "Certificado").map((t) => t.rotulo_id as string));
  const corpAx = new Map<string, string>();
  const nossos = alvo.filter((d) => !erpAx.has(d.id) && d.nosso_numero_corp).map((d) => d.nosso_numero_corp as number);
  for (let i = 0; i < nossos.length; i += 150) { const { data } = await sb.from("corp_anexos").select("nosso_numero,storage_path,rotulo_id,mime").in("nosso_numero", nossos.slice(i, i + 150)); for (const a of data ?? []) if (rotApol.has(a.rotulo_id as string) && String(a.mime ?? "").includes("pdf") && !corpAx.has(String(a.nosso_numero))) corpAx.set(String(a.nosso_numero), a.storage_path as string); }
  const out: { doc: Doc; origem: "erp" | "corp"; bucket: string; path: string }[] = [];
  for (const d of alvo) {
    if (erpAx.has(d.id)) out.push({ doc: d, origem: "erp", bucket: "anexos-documentos", path: erpAx.get(d.id)! });
    else if (d.nosso_numero_corp && corpAx.has(String(d.nosso_numero_corp))) out.push({ doc: d, origem: "corp", bucket: "corp-anexos", path: corpAx.get(String(d.nosso_numero_corp))! });
  }
  return out;
}

async function main() {
  const filtro = process.argv.slice(2).find((a, k, arr) => !a.startsWith("--") && arr[k - 1] !== "--limite");
  const reler = process.argv.includes("--reler-sem-quadro");
  const li = process.argv.indexOf("--limite"); const limite = li > 0 ? +process.argv[li + 1] : Infinity;
  const t0 = Date.now();
  let lista = await carregarDocs(filtro, reler);
  if (isFinite(limite)) lista = lista.slice(0, limite);
  console.log("a ler:", lista.length, "| lote", LOTE);
  const stat: Record<string, { lido: number; divergente: number; sem_texto: number; sem_quadro: number; invalido: number; erro: number }> = {};
  let i = 0;
  const trabalhar = async (it: (typeof lista)[number]) => {
    const { doc } = it; const s = (stat[doc.abrev] ??= { lido: 0, divergente: 0, sem_texto: 0, sem_quadro: 0, invalido: 0, erro: 0 });
    const { data } = await sb.storage.from(it.bucket).download(it.path);
    if (!data) { s.erro++; return; }
    const r = await abrirTextoPdfComSenha(Buffer.from(await data.arrayBuffer()), []);
    const t = (r?.texto ?? "").replace(/\s+/g, " ");
    const chave = MAPA_CHAVE[doc.abrev] ?? doc.abrev;
    const base = { documento_id: doc.id, seguradora_id: doc.seguradora_id, seguradora_chave: chave, fonte_pdf: `${it.origem}:${it.path}`, lote: LOTE, imobiliaria_id: doc.imobiliaria_principal_id, locatario_id: doc.locatario_id };
    if (t.length < 200) { s.sem_texto++; await sb.from("erp_apolice_pdf_campos").upsert({ ...base, situacao: "sem_texto", divergencias: ["PDF sem texto nativo (imagem)"] }); await sb.from("erp_apolice_pdf_leitura").upsert({ documento_id: doc.id, seguradora_chave: chave, situacao: "sem_texto", parcelas_lidas: 0 }); return; }
    const datas = [...new Set([...t.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`))].filter((d) => +d.slice(0, 4) >= 2000 && +d.slice(0, 4) <= 2040).sort();
    const docs = [...new Set([...t.matchAll(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g)].map((m) => dig(m[0])))];
    const premioTotal = num(t.match(/Pr[eê]mio\s+Total[^\d]{0,40}([\d.]+,\d{2})/i)?.[1]); const premioLiq = num(t.match(/Pr[eê]mio\s+L[ií]quido[^\d]{0,40}([\d.]+,\d{2})/i)?.[1]); const iof = num(t.match(/\bIOF[^\d]{0,30}([\d.]+,\d{2})/i)?.[1]);
    const forma = t.match(/\b(Cart[aã]o de Cr[eé]dito|D[eé]bito em Conta|Boleto(?: Banc[aá]rio)?|Fatura|Carn[eê]|Cart[aã]o)\b/i)?.[1] ?? null;
    const apNum = doc.numero_apolice ? dig(doc.numero_apolice) : "";
    const confereAp = apNum.length >= 4 ? dig(t).includes(apNum) : null;
    const confereVig = doc.vigencia_inicio ? datas.includes(doc.vigencia_inicio) : null; const avisos: string[] = []; if (confereVig && doc.vigencia_fim && !datas.includes(doc.vigencia_fim)) avisos.push("fim da vigência do documento não aparece no PDF");
    let confereDoc: boolean | null = null; let alvoDocs: string[] = [];
    { const { data: pa } = await sb.from("apolice_partes").select("locatarios:locatario_id(cpf)").eq("documento_id", doc.id); alvoDocs = (pa ?? []).map((p) => dig(String((p as unknown as { locatarios: { cpf: string | null } | null }).locatarios?.cpf ?? ""))).filter((x) => x.length >= 11); if (!alvoDocs.length && doc.locatario_id) { const { data: l } = await sb.from("locatarios").select("cpf").eq("id", doc.locatario_id).maybeSingle(); const c = dig(String(l?.cpf ?? "")); if (c.length >= 11) alvoDocs = [c]; } if (alvoDocs.length && docs.length) confereDoc = alvoDocs.some((c) => docs.includes(c)); }
    const div: string[] = [];
    if (confereAp === false) div.push("nº da apólice não aparece no PDF");
    if (confereVig === false) div.push("vigência do documento não aparece no PDF");
    if (confereDoc === false) { if (confereAp && confereVig) avisos.push("CPF/CNPJ do documento não localizado entre os do PDF (nº e vigência conferem)"); else div.push("CPF/CNPJ do documento não aparece no PDF"); }
    const parser = PARSERS[chave] as (typeof PARSERS)[string] | undefined; const bruto = parser ? parser(t) : [];
    const porN = new Map<number, string>(); for (const p of bruto) if (!porN.has(p.n)) porN.set(p.n, p.venc);
    const ns = [...porN.keys()].sort((a, b) => a - b);
    const seqOk = ns.length > 0 && ns.every((n, k) => n === k + 1) && ns.every((n, k) => k === 0 || porN.get(n)! > porN.get(ns[k - 1])!) && ns.length <= 60;
    let situacao: string;
    if (div.length) situacao = "divergente"; else if (parser && !ns.length) situacao = "sem_quadro"; else if (parser && !seqOk) situacao = "invalido"; else situacao = "lido";
    s[situacao as keyof typeof s]++;
    const parcelas = seqOk ? ns.map((n) => ({ n, vencimento: porN.get(n) })) : null;
    await sb.from("erp_apolice_pdf_campos").upsert({ ...base, situacao, numero_apolice_pdf: confereAp ? doc.numero_apolice : null, vigencia_ini_pdf: datas[0] ?? null, vigencia_fim_pdf: datas.length ? datas[datas.length - 1] : null, datas_no_pdf: datas.slice(0, 40), cpf_cnpj_pdf: docs.slice(0, 10), premio_total_pdf: premioTotal, premio_liquido_pdf: premioLiq, iof_pdf: iof, forma_pagamento_pdf: forma, qtd_parcelas_pdf: ns.length || null, parcelas, confere_apolice: confereAp, confere_vigencia: confereVig, confere_documento: confereDoc, divergencias: div.length ? div : null, avisos: avisos.length ? avisos : null });
    await sb.from("erp_apolice_pdf_leitura").upsert({ documento_id: doc.id, seguradora_chave: chave, situacao, parcelas_lidas: ns.length });
    if (situacao === "lido" && parcelas) await sb.from("erp_apolice_parcelas_pdf").upsert(ns.map((n) => ({ documento_id: doc.id, n, vencimento_pdf: porN.get(n)!, seguradora_chave: chave, anexo_path: it.path })));
  };
  const worker = async () => { while (i < lista.length) { const d = lista[i++]; try { await trabalhar(d); } catch (e) { (stat[d.doc.abrev] ??= { lido: 0, divergente: 0, sem_texto: 0, sem_quadro: 0, invalido: 0, erro: 0 }).erro++; console.log("erro", d.doc.id, String(e).slice(0, 90)); } if (i % 100 === 0) console.log(i, "/", lista.length, JSON.stringify(stat)); } };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  console.log("FIM em", Math.round((Date.now() - t0) / 1000), "s");
  console.table(stat);
}
main().catch((e) => { console.error("ERRO", e); process.exit(1); });
