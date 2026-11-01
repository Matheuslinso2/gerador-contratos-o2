// Fase 2 das coberturas de FIANÇA: lê direto o PDF (anexos do documento e anexos do Corp) dos documentos vigentes que ainda não têm
// coberturas em erp_documento_coberturas, com o leitor de apólices (scripts/apolices/leitores.ts). Fonte = PDF da seguradora, nível 1.
// Ensaio por padrão; --gravar grava (lote identificável, desfazer = coberturas-fianca-acervo.ts --desfazer --lote <LOTE>). Paralelo 1.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/coberturas-fianca-pdf.ts [--gravar] [--limite N] [--lote NOME]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
import { padronizarCoberturaFianca } from "@/lib/erp/coberturasFianca";
import { lerApolice } from "../apolices/leitores";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const LIMITE = Number(arg("limite") ?? 1e9);
const LOTE = arg("lote") ?? "COBERTURAS-FIANCA-PDF-20261101";
const sb = createServiceClient();

(async () => {
  const docs: { id: string; nosso_numero: number; nosso_numero_corp: number | null; seg: string }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from("erp_documentos").select("id,nosso_numero,nosso_numero_corp,seguradora:erp_seguradoras!inner(abreviacao),ramo:erp_ramos!inner(produto)")
      .eq("situacao", "vigente").in("tipo", ["A", "F"]).eq("ramo.produto", "fianca").order("id").range(de, de + 999);
    if (error) throw new Error(error.message);
    docs.push(...((data ?? []) as any[]).map((d) => ({ id: d.id, nosso_numero: d.nosso_numero, nosso_numero_corp: d.nosso_numero_corp, seg: d.seguradora.abreviacao })));
    if (!data || data.length < 1000) break;
  }
  const tem = new Set<string>();
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("erp_documento_coberturas").select("documento_id").eq("ordem", 1).range(de, de + 999);
    for (const x of data ?? []) tem.add(x.documento_id);
    if (!data || data.length < 1000) break;
  }
  const alvo = docs.filter((d) => !tem.has(d.id)).slice(0, LIMITE);
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${alvo.length} documentos de Fiança vigentes sem coberturas (de ${docs.length})`);
  const porSeg: Record<string, { docs: number; semPdf: number; lidos: number; semBloco: number; protegido: number; linhas: number }> = {};
  const linhasTodas: Record<string, unknown>[] = [];
  let n = 0;
  for (const d of alvo) {
    const s = (porSeg[d.seg] ??= { docs: 0, semPdf: 0, lidos: 0, semBloco: 0, protegido: 0, linhas: 0 });
    s.docs++;
    const pdfs: { bucket: string; path: string }[] = [];
    const { data: ax } = await sb.from("erp_documento_anexos").select("storage_path,nome_arquivo,tipo").eq("documento_id", d.id).limit(8);
    for (const a of ax ?? []) if (a.storage_path && /\.pdf$/i.test(a.nome_arquivo ?? "")) pdfs.push({ bucket: "anexos-documentos", path: a.storage_path });
    if (d.nosso_numero_corp) {
      const { data: ca } = await sb.from("corp_anexos").select("storage_path,nome,apolice").eq("nosso_numero", d.nosso_numero_corp).order("apolice", { ascending: false }).limit(8);
      for (const c of ca ?? []) if (c.storage_path && /\.pdf$/i.test(c.nome ?? "")) pdfs.push({ bucket: "corp-anexos", path: c.storage_path });
    }
    if (!pdfs.length) { s.semPdf++; continue; }
    let achou: { cob: { cobertura: string; verba: number | null; lmi: number | null }[]; ref: string } | null = null; let prot = false;
    for (const p of pdfs.slice(0, 5)) {
      const { data: blob } = await sb.storage.from(p.bucket).download(p.path);
      if (!blob) continue;
      const { t, protegido } = await textoDoPdf(Buffer.from(await blob.arrayBuffer()), []);
      if (protegido && !t) { prot = true; continue; }
      if (!t) continue;
      const l = lerApolice(t);
      if (l.coberturas.length) { achou = { cob: l.coberturas, ref: `${p.bucket}/${p.path}` }; break; }
    }
    if (!achou) { if (prot) s.protegido++; else s.semBloco++; continue; }
    s.lidos++;
    let ordem = 0; const vistos = new Set<string>();
    for (const c of achou.cob) {
      const orig = (c.cobertura ?? "").trim(); if (!orig) continue;
      const pad = padronizarCoberturaFianca(orig); const nome = pad?.nome ?? orig;
      if (vistos.has(nome)) continue; vistos.add(nome);
      linhasTodas.push({ documento_id: d.id, ordem: ++ordem, nome, nome_original: orig, tipo: pad?.tipo ?? "adicional", lmi: c.lmi, premio: null, verba: c.verba, franquia: null, fonte: "pdf", fonte_ref: achou.ref, nivel: 1, lote: LOTE });
      s.linhas++;
    }
    if (!GRAVAR && n < 3) { n++; console.log(`\n${d.seg} ${d.nosso_numero}:`); for (const l of linhasTodas.slice(-ordem)) console.log(`  [${l.tipo}] ${l.nome} | LMI ${l.lmi ?? "—"} | verba ${l.verba ?? "—"}`); }
  }
  for (const [k, v] of Object.entries(porSeg)) console.log(`${k}: sem coberturas ${v.docs} | sem PDF ${v.semPdf} | lidos ${v.lidos} (${v.linhas} linhas) | PDF sem bloco de coberturas ${v.semBloco} | protegido ${v.protegido}`);
  if (!GRAVAR) return;
  for (let i = 0; i < linhasTodas.length; i += 200) {
    const { error } = await sb.from("erp_documento_coberturas").upsert(linhasTodas.slice(i, i + 200), { onConflict: "documento_id,fonte,ordem" });
    if (error) throw new Error(error.message);
  }
  console.log(`gravadas ${linhasTodas.length} linhas`);
})();
