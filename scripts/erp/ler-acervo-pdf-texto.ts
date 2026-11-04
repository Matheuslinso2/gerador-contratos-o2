process.loadEnvFile(".env.local");
// Lê UMA VEZ o texto de TODOS os PDFs do acervo (apólice, certificado, proposta, endosso, cotação) — do ERP e do Corp, inclusive o que o robô
// "Robo Corp Anexos" ainda está baixando — e guarda em erp_apolice_pdf_texto (um registro por PDF). Matheus 04/11/2026: ler tudo uma vez só;
// os parsers por modelo (seguradora+produto) rodam depois em cima deste texto, sem baixar o PDF de novo. Só leitura dos PDFs: nada é alterado no ERP.
// PDF sem texto (imagem) fica registrado como metodo='sem_texto' para o OCR local (scripts/erp/ocr-pdf-win.ps1); PDF protegido tenta CPF do titular.
// Uso: tsx scripts/erp/ler-acervo-pdf-texto.ts [--continuo] [--limite N] [--tipos apolice,proposta,...]
//   --continuo: ao terminar, espera 10 min e repete (pega o que o robô baixou nesse meio-tempo) até 3 rodadas seguidas sem novidade.
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha } from "@/lib/pdfComSenha";
import { textoDoPdf } from "@/lib/erp/anexosEmail";

const sb = createServiceClient();
const LEITOR_VERSAO = "acervo-v1-2026-11-04";
const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const TIPOS_ERP = (arg("--tipos") ?? "apolice,certificado,proposta,endosso,cotacao").split(",");
const LIMITE = arg("--limite") ? +arg("--limite")! : Infinity;
const CONTINUO = process.argv.includes("--continuo");
const dig = (s: string) => s.replace(/\D/g, "");
const PRIORIDADE: Record<string, number> = { apolice: 0, certificado: 1, endosso: 2, proposta: 3, cotacao: 4 };

type Item = { documento_id: string | null; origem: "erp" | "corp" | "email"; bucket: string; path: string; tipo: string; nosso: number | null; email_anexo_id?: string; seguradora?: string | null };
const EMAILS = process.argv.includes("--emails");

// PDFs anexados aos e-mails das caixas da O2 (já classificados em erp_email_anexos): entram SEM documento; o vínculo vem depois, provado pelo conteúdo.
async function montarFilaEmails(): Promise<Item[]> {
  const feitos = new Set((await paginar<{ fonte_pdf: string }>((a, b) => sb.from("erp_apolice_pdf_texto").select("fonte_pdf").like("fonte_pdf", "email:%").order("id").range(a, b))).map((x) => x.fonte_pdf));
  const ax = await paginar<{ id: string; storage_bucket: string; storage_path: string; classe: string; seguradora: string | null; documento_id: string | null; criado_em: string }>((a, b) =>
    sb.from("erp_email_anexos").select("id,storage_bucket,storage_path,classe,seguradora,documento_id,criado_em").in("classe", TIPOS_ERP).not("storage_path", "is", null).order("id").range(a, b));
  return ax.filter((x) => !feitos.has(`email:${x.storage_path}`))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em) || PRIORIDADE[a.classe] - PRIORIDADE[b.classe])
    .map((x) => ({ documento_id: x.documento_id, origem: "email" as const, bucket: x.storage_bucket, path: x.storage_path, tipo: x.classe, nosso: null, email_anexo_id: x.id, seguradora: x.seguradora }));
}

async function paginar<T>(f: (de: number, ate: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) { const { data } = await f(off, off + 999); if (!data?.length) break; out.push(...data); if (data.length < 1000) break; }
  return out;
}

async function montarFila(): Promise<Item[]> {
  const feitos = new Set((await paginar<{ documento_id: string; fonte_pdf: string }>((a, b) => sb.from("erp_apolice_pdf_texto").select("documento_id,fonte_pdf").order("id").range(a, b))).map((x) => `${x.documento_id}|${x.fonte_pdf}`));
  const fila: Item[] = [];
  // 1) anexos do ERP
  const erp = await paginar<{ documento_id: string; storage_path: string; tipo: string }>((a, b) => sb.from("erp_documento_anexos").select("documento_id,storage_path,tipo").in("tipo", TIPOS_ERP).order("id").range(a, b));
  for (const x of erp) if (/\.pdf$/i.test(x.storage_path) && !feitos.has(`${x.documento_id}|erp:${x.storage_path}`)) fila.push({ documento_id: x.documento_id, origem: "erp", bucket: "anexos-documentos", path: x.storage_path, tipo: x.tipo, nosso: null });
  // 2) anexos do Corp (ligados ao documento pelo Nosso nº do Corp)
  const { data: tipos } = await sb.from("corp_anexos_tipos").select("rotulo_id,tipo");
  const mapa: Record<string, string> = { "Apólice": "apolice", "Certificado": "certificado", "Proposta": "proposta", "Endosso": "endosso" };
  const rotulos = new Map((tipos ?? []).filter((t) => mapa[t.tipo as string] && TIPOS_ERP.includes(mapa[t.tipo as string])).map((t) => [t.rotulo_id as string, mapa[t.tipo as string]]));
  const corp = await paginar<{ nosso_numero: number; storage_path: string; rotulo_id: string; mime: string | null }>((a, b) => sb.from("corp_anexos").select("nosso_numero,storage_path,rotulo_id,mime").order("id").range(a, b));
  // chave sempre em texto: corp_anexos.nosso_numero e erp_documentos.nosso_numero_corp têm tipos diferentes (o Map não casava 8 mil anexos)
  const porNosso = new Map<string, string>();
  const nossos = [...new Set(corp.filter((c) => rotulos.has(c.rotulo_id)).map((c) => String(c.nosso_numero)))];
  for (let i = 0; i < nossos.length; i += 200) { const { data } = await sb.from("erp_documentos").select("id,nosso_numero_corp").in("nosso_numero_corp", nossos.slice(i, i + 200)).neq("situacao", "duplicado"); for (const d of data ?? []) porNosso.set(String(d.nosso_numero_corp), d.id as string); }
  let semDoc = 0;
  for (const c of corp) {
    const tp = rotulos.get(c.rotulo_id); if (!tp || !String(c.mime ?? "pdf").toLowerCase().includes("pdf")) continue;
    const did = porNosso.get(String(c.nosso_numero)); if (!did) { semDoc++; continue; }
    if (!feitos.has(`${did}|corp:${c.storage_path}`)) fila.push({ documento_id: did, origem: "corp", bucket: "corp-anexos", path: c.storage_path, tipo: tp, nosso: c.nosso_numero });
  }
  if (semDoc) console.log(`(${semDoc} anexos do Corp sem documento correspondente no ERP: ficam para quando o documento entrar)`);
  // recentes primeiro (renovações e vigentes antes do histórico); apólice antes de proposta
  const ids = [...new Set(fila.map((f) => f.documento_id))]; const ini = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) { const { data } = await sb.from("erp_documentos").select("id,vigencia_inicio").in("id", ids.slice(i, i + 200)); for (const d of data ?? []) ini.set(d.id as string, (d.vigencia_inicio as string) ?? "0000"); }
  return fila.sort((a, b) => (ini.get(b.documento_id ?? "") ?? "").localeCompare(ini.get(a.documento_id ?? "") ?? "") || PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo]);
}

async function lerUm(it: Item, st: Record<string, number>) {
  const { data } = await sb.storage.from(it.bucket).download(it.path);
  if (!data) { st.erro_download++; return; }
  const buf = Buffer.from(await data.arrayBuffer());
  let t = ((await abrirTextoPdfComSenha(buf, []))?.texto ?? "").replace(/\s+/g, " ");
  if (t.length < 200 && it.documento_id) {
    const cpfs: string[] = [];
    const { data: d } = await sb.from("erp_documentos").select("locatario_id").eq("id", it.documento_id).maybeSingle();
    if (d?.locatario_id) { const { data: l } = await sb.from("locatarios").select("cpf").eq("id", d.locatario_id).maybeSingle(); if (l?.cpf) cpfs.push(String(l.cpf)); }
    const { data: pa } = await sb.from("erp_doc_partes_acervo").select("locatario:locatarios(cpf)").eq("documento_id", it.documento_id);
    for (const p of (pa ?? []) as unknown as { locatario: { cpf: string | null } | null }[]) if (p.locatario?.cpf) cpfs.push(p.locatario.cpf);
    const r2 = await textoDoPdf(buf, [...new Set(cpfs.map(dig).filter((c) => c.length >= 11))]);
    if (r2.t && r2.t.length > t.length) t = r2.t.replace(/\s+/g, " ");
  }
  let chave: string | null = it.seguradora ?? null;
  if (it.documento_id) {
    const { data: seg } = await sb.from("erp_documentos").select("seguradora:erp_seguradoras(abreviacao)").eq("id", it.documento_id).maybeSingle();
    const s0 = (seg as unknown as { seguradora: { abreviacao: string } | { abreviacao: string }[] | null } | null)?.seguradora;
    chave = (Array.isArray(s0) ? s0[0] : s0)?.abreviacao ?? chave;
  }
  t = t.replace(/\u0000/g, "").replace(/[\uD800-\uDFFF]/g, "");
  const ok = t.length >= 200;
  const linha = { documento_id: it.documento_id, seguradora_chave: chave, texto: ok ? t : null, metodo: ok ? "texto_nativo" : "sem_texto", fonte_pdf: `${it.origem}:${it.path}`, tipo_anexo: it.tipo, nosso_numero_corp: it.nosso, leitor_versao: LEITOR_VERSAO, email_anexo_id: it.email_anexo_id ?? null };
  const { error: eUp } = it.documento_id
    ? await sb.from("erp_apolice_pdf_texto").upsert(linha, { onConflict: "documento_id,fonte_pdf" })
    : await sb.from("erp_apolice_pdf_texto").insert(linha);
  if (eUp) { st.erro++; console.log("erro ao gravar", it.path, eUp.message.slice(0, 120)); return; }
  st[ok ? "lido" : "sem_texto"]++;
}

async function rodada(): Promise<number> {
  let fila = EMAILS ? await montarFilaEmails() : await montarFila(); if (isFinite(LIMITE)) fila = fila.slice(0, LIMITE);
  console.log(new Date().toISOString(), "a ler:", fila.length);
  const st: Record<string, number> = { lido: 0, sem_texto: 0, erro_download: 0, erro: 0 }; let i = 0;
  const worker = async () => { while (i < fila.length) { const it = fila[i++]; try { await lerUm(it, st); } catch (e) { st.erro++; console.log("erro", it.path, String(e).slice(0, 80)); } if (i % 200 === 0) console.log(i, "/", fila.length, JSON.stringify(st)); } };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  console.log("rodada concluída", JSON.stringify(st));
  // aplica os parsers por modelo e os vínculos sobre o texto recém-guardado (erp_pdf_pipeline, no banco)
  if (fila.length) { const { data, error } = await sb.rpc("erp_pdf_pipeline"); console.log("pipeline", error ? "ERRO " + error.message : JSON.stringify(data)); }
  return fila.length;
}

async function main() {
  let vazias = 0;
  do {
    const n = await rodada();
    vazias = n === 0 ? vazias + 1 : 0;
    if (!CONTINUO) break;
    if (vazias >= 3) break;
    await new Promise((r) => setTimeout(r, 10 * 60 * 1000));
  } while (true);
  console.log("FIM");
}
main().catch((e) => { console.error("ERRO", e); process.exit(1); });
