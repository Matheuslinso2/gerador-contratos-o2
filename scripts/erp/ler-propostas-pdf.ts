process.loadEnvFile(".env.local");
// Lê o PDF da PROPOSTA (corp_anexos com rótulo "Proposta" e erp_documento_anexos tipo proposta) com o texto nativo (sem IA, sem custo; imagem = OCR local do Windows
// via --ocr-jsonl) e grava os campos estruturados em erp_proposta_pdf_campos (nível 1, sem texto bruto, com versão do leitor).
// Confere nº da proposta, início da vigência e CPF/CNPJ contra o documento. Quem aplica nos vazios de erp_documentos é o passo --aplicar (nunca sobrescreve).
// Uso: tsx scripts/erp/ler-propostas-pdf.ts [ABREV] [--limite N] [--refazer] [--ocr-jsonl arq] [--aplicar]
import fs from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha } from "@/lib/pdfComSenha";

const sb = createServiceClient();
const LEITOR_VERSAO = "prop-v1-2026-11-02";
const LOTE = "PROPOSTAS-" + new Date().toISOString().slice(0, 10);
const OCR_ARQ = process.argv.includes("--ocr-jsonl") ? process.argv[process.argv.indexOf("--ocr-jsonl") + 1] : null;
const OCR = new Map<string, string>();
if (OCR_ARQ) for (const l of fs.readFileSync(OCR_ARQ, "utf8").split("\n")) { if (!l.trim()) continue; try { const o = JSON.parse(l) as { arq: string; paginas?: { texto: string }[] }; const id = /__([0-9a-f-]{36})\.pdf/.exec(o.arq)?.[1]; if (id && o.paginas) OCR.set(id, o.paginas.map((p) => p.texto).join("\n")); } catch { /* linha inválida */ } }

const MAPA_CHAVE: Record<string, string> = { PORT: "PORTO", TOKI: "TOKIO", TOO: "TOO", ALLI: "ALLIANZ", YELU: "YELUM", POTT: "POTTENCIAL" };
const num = (s?: string | null) => (s ? Number(s.replace(/R\$\s?/, "").replace(/\./g, "").replace(",", ".")) : null);
const dig = (s: string) => s.replace(/\D/g, "");
const iso = (d: string) => d.split("/").reverse().join("-");
const N = "([\\d.]+,\\d{2})";

type Doc = { id: string; nosso_numero_corp: number | null; numero_proposta: string | null; vigencia_inicio: string | null; seguradora_id: string; abrev: string; imobiliaria_principal_id: string | null; locatario_id: string | null };

function extrair(t: string) {
  const g = (re: RegExp) => re.exec(t)?.[1]?.trim() ?? null;
  const datas = [...new Set([...t.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`))].filter((d) => +d.slice(0, 4) >= 2000 && +d.slice(0, 4) <= 2040).sort();
  const cpfs = [...new Set([...t.matchAll(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\bCPF\s+(\d{9}-?\d{2})\b/g)].map((m) => dig(m[1] ?? m[0])))];
  const numeroProposta = g(/N[º°o.]*\s*(?:DA\s+)?PROPOSTA(?:\s+COMPANHIA)?[^\d]{0,30}((?:\d{2}\s?-\s?)?\d[\d.\-]{5,24})/i) ?? g(/PROPOSTA\s+N[º°o.]*\s*:?\s*(\d[\d.\-]{5,24})/i) ?? g(/N\. PROPOSTA COMPANHIA \d+ - (\d+)/i);
  const orcamento = g(/N[ÚU]MERO DO OR[ÇC]AMENTO\s*(\d+)/i) ?? g(/OR[ÇC]AMENTO[^\d]{0,15}(\d{6,})/i);
  const apolice = g(/N[º°o.]*\s*(?:DA\s+)?AP[ÓO]LICE[^\d]{0,15}([\d.\-]{6,30})/i);
  const vig = /VIG[ÊE]NCIA[^\d]{0,60}(\d{2}\/\d{2}\/\d{4})[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  const dataProposta = g(/DATA (?:DA PROPOSTA|DE C[ÁA]LCULO|DE EMISS[ÃA]O|DA COTA[ÇC][ÃA]O)[^\d]{0,10}(\d{2}\/\d{2}\/\d{4})/i);
  const nome = g(/(?:PROPONENTE|NOME DO SEGURADO|NOME \/ RAZ[ÃA]O SOCIAL|DADOS DO SEGURADO NOME|Nome do Segurado)\s+([A-ZÀ-Ú0-9][A-ZÀ-Ú0-9 .&'\/-]{3,70}?)(?:\s+(?:TIPO DE PESSOA|NOME SOCIAL|CPF|CNPJ|PROFISS|ENDERE))/i);
  const produto = g(/PRODUTO\s+(?:PRODUTO\s+)?([A-Za-zÀ-ú0-9 ()%\/.-]{4,60}?)(?:\s+PROCESSO|\s+MODALIDADE|\s+TITULAR)/i) ?? g(/(Seguro Fian[çc]a[^.]{0,30}|Seguro Inc[êe]ndio[^.]{0,30}|Aluguel \d+ Meses \(\d+%\))/i);
  const local = g(/LOCAL DE RISCO\s*(?:CEP\s*[\d-]+\s*CIDADE\s*)?(.{10,140}?)(?:\s+PRIMEIRO LOCAT|\s+INFORMA|\s+COBERTURAS|\s+DADOS|$)/i);
  const demo = new RegExp("Pr[eê]mio L[ií]quido \\(R\\$\\) Adic\\. ?Frac \\(R\\$\\) Custo Ap[oó]lice \\(R\\$\\) IOF \\(R\\$\\) Pr[eê]mio Total \\(R\\$\\) " + N + " " + N + " " + N + " " + N + " " + N, "i").exec(t);
  const liq = demo ? num(demo[1]) : num(g(new RegExp("Pr[eê]mio\\s+L[ií]quido[^\\d]{0,40}" + N, "i")));
  const total = demo ? num(demo[5]) : num(g(new RegExp("Pr[eê]mio\\s+Total[^\\d]{0,40}" + N, "i")));
  const iof = demo ? num(demo[4]) : num(g(new RegExp("\\bIOF[^\\d]{0,30}" + N, "i")));
  const adic = demo ? num(demo[2]) : null; const custo = demo ? num(demo[3]) : null;
  const forma = g(/Tipo de Cobran[çc]a[^A-Za-z]{0,30}([A-Z ]{4,40}?)(?:\s+Dia|\s+\d)/) ?? g(/FORMA DE PAGAMENTO\s*[-:]?\s*(?:Periodicidade\s+\w+\s+)?([A-Za-zÀ-ú \/]{4,40}?)(?:\s+\d|\s+Dia|\s+Tipo)/i) ?? g(/\b(Cart[aã]o de Cr[eé]dito|D[eé]bito em Conta|Boleto(?: Banc[aá]rio)?|Fatura(?: mensal)?|Ficha(?: Faturada)?|COBRAN[ÇC]A AGRUPADA|FATURAS IMOBILI[AÁ]RIAS)\b/i);
  const parc = /Pagamento: .{3,50}? em (\d{1,2}) ?x (?:sem|com) juros: R\$ ?([\d.]+,\d{2})/i.exec(t) ?? /Pagamento em (\d{1,2}) mensalidade\(s\) de R\$ ?([\d.]+,\d{2})/i.exec(t);
  const venc1Tokio = /mensalidade\(s\) de R\$ ?[\d.]+,\d{2},? sendo a 1[ªa] parcela[^.]{0,40}? vencimento em (\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1] ?? null;
  const dataTokio = /Vers[ãa]o [\d./]+ Data (\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1] ?? null;
  const qtd = parc ? +parc[1] : (g(/N[º°o]* de Parcelas:?\s*(\d{1,2})/i) ? Number(g(/N[º°o]* de Parcelas:?\s*(\d{1,2})/i)) : (g(/\b(\d{1,2})\s?[xX]\s+(?:de\s+)?R\$/) ? Number(g(/\b(\d{1,2})\s?[xX]\s+(?:de\s+)?R\$/)) : null));
  const dia = g(/Dia Preferencial para Pagamento[^\d]{0,80}?(\d{1,2})\s/i) ?? g(/DIA (?:DE )?(?:PAGAMENTO|VENCIMENTO)[^\d]{0,10}(\d{1,2})\b/i);
  const venc1 = g(/(?:1[ªa]\.? ?parcela|primeiro vencimento|vencimento da 1[ªa] parcela)[^\d]{0,20}(\d{2}\/\d{2}\/\d{4})/i);
  const comissao = g(/(?:Remunera[çc][ãa]o|Comiss[ãa]o)\s*\(%\)[^\d]{0,80}?(\d{1,2},\d{2})/i) ?? g(/Comiss[ãa]o:?\s*(\d{1,2}(?:,\d{1,2})?)\s?%/i);
  return {
    datas, cpfs, numeroProposta, orcamento, apolice, vigIni: vig ? iso(vig[1]) : null, vigFim: vig ? iso(vig[2]) : null, dataProposta: dataProposta ? iso(dataProposta) : dataTokio ? iso(dataTokio) : null, nome, produto, local,
    liq, total, iof: iof != null && liq != null && iof >= liq ? null : iof, adic, custo, forma: forma && !/^Pagamento em$/i.test(forma) ? forma : (parc && /mensalidade/i.test(parc[0]) ? null : null), qtd, valorParcela: parc ? num(parc[2]) : null, dia: dia ? +dia : null,
    venc1: venc1Tokio ? iso(venc1Tokio) : venc1 ? iso(venc1) : null, comissao: comissao ? num(comissao) : null,
  };
}

async function carregar(filtro: string | undefined, refazer: boolean) {
  const { data: segs } = await sb.from("erp_seguradoras").select("id,abreviacao");
  const abrev = new Map((segs ?? []).map((s) => [s.id as string, s.abreviacao as string]));
  const { data: tipos } = await sb.from("corp_anexos_tipos").select("rotulo_id,tipo");
  const rotProp = new Set((tipos ?? []).filter((t) => t.tipo === "Proposta").map((t) => t.rotulo_id as string));
  const pdfPorNosso = new Map<string, string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from("corp_anexos").select("nosso_numero,storage_path,rotulo_id,mime,ordem").order("nosso_numero").order("ordem").range(off, off + 999);
    if (!data?.length) break;
    for (const a of data) if (rotProp.has(a.rotulo_id as string) && String(a.mime ?? "").includes("pdf") && !pdfPorNosso.has(String(a.nosso_numero))) pdfPorNosso.set(String(a.nosso_numero), a.storage_path as string);
    if (data.length < 1000) break;
  }
  const ja = new Map<string, string>();
  for (let off = 0; ; off += 1000) { const { data } = await sb.from("erp_proposta_pdf_campos").select("documento_id,situacao").order("documento_id").range(off, off + 999); if (!data?.length) break; data.forEach((x) => ja.set(x.documento_id as string, x.situacao as string)); if (data.length < 1000) break; }
  const lista: { doc: Doc; origem: "erp" | "corp"; bucket: string; path: string }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from("erp_documentos").select("id,nosso_numero_corp,numero_proposta,vigencia_inicio,seguradora_id,imobiliaria_principal_id,locatario_id").not("nosso_numero_corp", "is", null).order("id").range(off, off + 999);
    if (!data?.length) break;
    for (const d of data) {
      const p = pdfPorNosso.get(String(d.nosso_numero_corp)); if (!p) continue;
      const doc = { ...(d as unknown as Doc), abrev: abrev.get(d.seguradora_id as string) ?? "?" };
      if (filtro && doc.abrev !== filtro) continue;
      if (ja.has(doc.id) && !(refazer && ja.get(doc.id) !== "lido")) continue;
      lista.push({ doc, origem: "corp", bucket: "corp-anexos", path: p });
    }
    if (data.length < 1000) break;
  }
  const ids = lista.map((x) => x.doc.id);
  const { data: ex } = await sb.from("erp_documento_anexos").select("documento_id,storage_path").eq("tipo", "proposta");
  for (const a of ex ?? []) if (!ids.includes(a.documento_id as string) && !ja.has(a.documento_id as string)) {
    const { data: d } = await sb.from("erp_documentos").select("id,nosso_numero_corp,numero_proposta,vigencia_inicio,seguradora_id,imobiliaria_principal_id,locatario_id").eq("id", a.documento_id).maybeSingle();
    if (d) lista.push({ doc: { ...(d as unknown as Doc), abrev: abrev.get(d.seguradora_id as string) ?? "?" }, origem: "erp", bucket: "anexos-documentos", path: a.storage_path as string });
  }
  return lista;
}

async function aplicar() {
  // preenche SÓ o que está vazio em erp_documentos, quando a proposta confere (nº da proposta + início da vigência, quando o documento os tem); registra o que aplicou
  const { data } = await sb.from("erp_proposta_pdf_campos").select("*").eq("situacao", "lido").is("aplicado_em", null);
  let docs = 0; const cont: Record<string, number> = {};
  for (const c of data ?? []) {
    const { data: d } = await sb.from("erp_documentos").select("id,numero_proposta,forma_pagamento,qtd_parcelas,prazo_1a_dias,dia_fixo,iof,premio_liquido,tipo").eq("id", c.documento_id).single();
    if (!d) continue;
    const up: Record<string, unknown> = {}; const campos: string[] = [];
    if (!d.numero_proposta && c.numero_proposta_pdf) { up.numero_proposta = c.numero_proposta_pdf; campos.push("numero_proposta"); }
    if ((!d.qtd_parcelas || d.qtd_parcelas === 0) && c.qtd_parcelas_pdf) { up.qtd_parcelas = c.qtd_parcelas_pdf; campos.push("qtd_parcelas"); }
    if (!d.dia_fixo && c.dia_pagamento_pdf) { up.dia_fixo = c.dia_pagamento_pdf; campos.push("dia_fixo"); }
    if (campos.length) { const { error } = await sb.from("erp_documentos").update(up).eq("id", d.id); if (error) { console.log("erro", d.id, error.message.slice(0, 80)); continue; } docs++; for (const k of campos) cont[k] = (cont[k] ?? 0) + 1; }
    await sb.from("erp_proposta_pdf_campos").update({ aplicado_em: new Date().toISOString(), aplicado_campos: campos }).eq("documento_id", c.documento_id);
  }
  console.log("aplicado em", docs, "documentos:", JSON.stringify(cont));
}

async function main() {
  if (process.argv.includes("--aplicar")) return aplicar();
  const filtro = process.argv.slice(2).find((a, k, arr) => !a.startsWith("--") && arr[k - 1] !== "--limite" && arr[k - 1] !== "--ocr-jsonl");
  const li = process.argv.indexOf("--limite"); const limite = li > 0 ? +process.argv[li + 1] : Infinity;
  const t0 = Date.now();
  let lista = await carregar(filtro, process.argv.includes("--refazer"));
  if (OCR_ARQ) lista = lista.filter((x) => OCR.has(x.doc.id));
  if (isFinite(limite)) lista = lista.slice(0, limite);
  console.log("propostas a ler:", lista.length, "| lote", LOTE);
  const stat: Record<string, Record<string, number>> = {}; let i = 0;
  const um = async (it: (typeof lista)[number]) => {
    const { doc } = it; const s = (stat[doc.abrev] ??= { lido: 0, divergente: 0, sem_texto: 0, erro: 0 });
    let t: string;
    if (OCR.has(doc.id)) t = OCR.get(doc.id)!.replace(/\s+/g, " ");
    else { const { data } = await sb.storage.from(it.bucket).download(it.path); if (!data) { s.erro++; return; } t = ((await abrirTextoPdfComSenha(Buffer.from(await data.arrayBuffer()), []))?.texto ?? "").replace(/\s+/g, " "); }
    const base = { documento_id: doc.id, seguradora_id: doc.seguradora_id, seguradora_chave: MAPA_CHAVE[doc.abrev] ?? doc.abrev, fonte_pdf: `${it.origem}:${it.path}`, lote: LOTE, leitor_versao: LEITOR_VERSAO, imobiliaria_id: doc.imobiliaria_principal_id, locatario_id: doc.locatario_id,
      fonte: `PDF da proposta (${OCR.has(doc.id) ? "OCR local do Windows" : "texto nativo"}) · ${LEITOR_VERSAO}` };
    if (t.length < 200) { s.sem_texto++; await sb.from("erp_proposta_pdf_campos").upsert({ ...base, situacao: "sem_texto", divergencias: ["PDF sem texto nativo (imagem)"] }); return; }
    const x = extrair(t);
    const nProp = doc.numero_proposta ? dig(doc.numero_proposta) : "";
    const confereProp = nProp.length >= 4 ? dig(t).includes(nProp) : null;
    const confereVig = doc.vigencia_inicio ? x.datas.includes(doc.vigencia_inicio) : null;
    let confereDoc: boolean | null = null;
    { const { data: pa } = await sb.from("apolice_partes").select("locatarios:locatario_id(cpf)").eq("documento_id", doc.id); let alvo = (pa ?? []).map((p) => dig(String((p as unknown as { locatarios: { cpf: string | null } | null }).locatarios?.cpf ?? ""))).filter((c) => c.length >= 11);
      if (!alvo.length && doc.locatario_id) { const { data: l } = await sb.from("locatarios").select("cpf").eq("id", doc.locatario_id).maybeSingle(); const c = dig(String(l?.cpf ?? "")); if (c.length >= 11) alvo = [c]; }
      if (alvo.length && x.cpfs.length) confereDoc = alvo.some((c) => x.cpfs.includes(c)); }
    const div: string[] = []; const avisos: string[] = [];
    if (confereProp === false) div.push("nº da proposta do documento não aparece no PDF");
    if (confereVig === false) div.push("início da vigência do documento não aparece no PDF");
    if (confereDoc === false) { if (confereProp || confereVig) avisos.push("CPF/CNPJ do documento não localizado entre os do PDF"); else div.push("CPF/CNPJ do documento não aparece no PDF"); }
    if (!x.numeroProposta) avisos.push("nº da proposta não reconhecido no layout");
    const situacao = div.length ? "divergente" : "lido"; s[situacao]++;
    await sb.from("erp_proposta_pdf_campos").upsert({ ...base, situacao, numero_proposta_pdf: x.numeroProposta, numero_orcamento_pdf: x.orcamento, numero_apolice_pdf: x.apolice, data_proposta_pdf: x.dataProposta, vigencia_ini_pdf: x.vigIni, vigencia_fim_pdf: x.vigFim,
      segurado_nome_pdf: x.nome, cpf_cnpj_pdf: x.cpfs.slice(0, 10), produto_pdf: x.produto, local_risco_pdf: x.local, premio_liquido_pdf: x.liq, adicional_fracionamento_pdf: x.adic, custo_apolice_pdf: x.custo, iof_pdf: x.iof, premio_total_pdf: x.total,
      forma_pagamento_pdf: x.forma, qtd_parcelas_pdf: x.qtd, valor_parcela_pdf: x.valorParcela, vencimento_1a_pdf: x.venc1, dia_pagamento_pdf: x.dia, comissao_pct_pdf: x.comissao, datas_no_pdf: x.datas.slice(0, 40),
      confere_proposta: confereProp, confere_vigencia: confereVig, confere_documento: confereDoc, divergencias: div.length ? div : null, avisos: avisos.length ? avisos : null });
  };
  const worker = async () => { while (i < lista.length) { const d = lista[i++]; try { await um(d); } catch (e) { (stat[d.doc.abrev] ??= { lido: 0, divergente: 0, sem_texto: 0, erro: 0 }).erro++; console.log("erro", d.doc.id, String(e).slice(0, 90)); } if (i % 200 === 0) console.log(i, "/", lista.length, JSON.stringify(stat)); } };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  console.log("FIM em", Math.round((Date.now() - t0) / 1000), "s"); console.table(stat);
}
main().catch((e) => { console.error("ERRO", e); process.exit(1); });
