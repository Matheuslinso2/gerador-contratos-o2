// Lê as coberturas contratadas do PDF das apólices de Incêndio vigentes (Matheus 29/10: prioridade Fiança, Incêndio e Automóvel).
// Ensaio por padrão (mostra o que leu); --gravar grava em erp_documento_coberturas.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ler-coberturas-incendio.ts [--amostra N] [--seguradora PORT] [--gravar] [--mostrar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
import { lerCoberturasIncendio } from "@/lib/erp/coberturasIncendio";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const MOSTRAR = process.argv.includes("--mostrar");
const AMOSTRA = Number(arg("amostra") ?? 1e9);
const SEG = arg("seguradora");
const sb = createServiceClient();

(async () => {
  let q = sb.from("erp_documentos")
    .select("id, nosso_numero, nosso_numero_corp, seguradora:erp_seguradoras!inner(abreviacao), ramo:erp_ramos!inner(produto)")
    .eq("situacao", "vigente").in("tipo", ["A", "F"]).eq("ramo.produto", "incendio").order("vigencia_fim", { ascending: true }).limit(Math.min(AMOSTRA, 5000));
  if (SEG) q = q.eq("seguradora.abreviacao", SEG);
  const { data: docs } = await q;
  const alvo = (docs ?? []) as unknown as { id: string; nosso_numero: number; nosso_numero_corp: number | null; seguradora: { abreviacao: string } }[];
  console.log(`${alvo.length} documentos de Incêndio vigentes (${GRAVAR ? "GRAVANDO" : "ENSAIO"})`);
  const porSeg: Record<string, { docs: number; lidos: number; semPdf: number; semBloco: number; protegido: number }> = {};
  let n = 0;
  for (const d of alvo) {
    const s = (porSeg[d.seguradora.abreviacao] ??= { docs: 0, lidos: 0, semPdf: 0, semBloco: 0, protegido: 0 });
    s.docs++;
    const pdfs: { bucket: string; path: string }[] = [];
    const { data: ax } = await sb.from("erp_documento_anexos").select("storage_path, nome_arquivo, tipo").eq("documento_id", d.id).limit(6);
    for (const a of ax ?? []) if (a.storage_path && /\.pdf$/i.test(a.nome_arquivo ?? "")) pdfs.push({ bucket: "anexos-documentos", path: a.storage_path });
    if (d.nosso_numero_corp) {
      const { data: ca } = await sb.from("corp_anexos").select("storage_path, nome").eq("nosso_numero", d.nosso_numero_corp).limit(8);
      for (const c of ca ?? []) if (c.storage_path && /\.pdf$/i.test(c.nome ?? "")) pdfs.push({ bucket: "corp-anexos", path: c.storage_path });
    }
    if (!pdfs.length) { s.semPdf++; continue; }
    let lista: ReturnType<typeof lerCoberturasIncendio> = [];
    let protegido = false;
    for (const p of pdfs.slice(0, 4)) {
      const { data: blob } = await sb.storage.from(p.bucket).download(p.path);
      if (!blob) continue;
      const { t, protegido: pr } = await textoDoPdf(Buffer.from(await blob.arrayBuffer()), []);
      if (pr && !t) protegido = true;
      if (!t) continue;
      lista = lerCoberturasIncendio(t);
      if (lista.length) break;
    }
    if (!lista.length) { if (protegido) s.protegido++; else s.semBloco++; continue; }
    s.lidos++;
    if (MOSTRAR && n < 12) { n++; console.log(`\n${d.seguradora.abreviacao} ${d.nosso_numero}:`); for (const c of lista) console.log(`  [${c.tipo}] ${c.nome}${c.nome !== c.nome_original ? ` (${c.nome_original})` : ""} | LMI ${c.lmi ?? "—"} | prêmio ${c.premio ?? "—"}`); }
    if (GRAVAR) {
      await sb.from("erp_documento_coberturas").delete().eq("documento_id", d.id).eq("fonte", "pdf");
      const { error } = await sb.from("erp_documento_coberturas").insert(lista.map((c) => ({ documento_id: d.id, ordem: c.ordem, nome: c.nome, nome_original: c.nome_original, tipo: c.tipo, lmi: c.lmi, premio: c.premio, fonte: "pdf" })));
      if (error) console.log(`  erro ${d.nosso_numero}: ${error.message}`);
    }
  }
  console.log("\nseguradora | docs | lidos | sem PDF | PDF sem bloco | protegido");
  for (const [k, v] of Object.entries(porSeg)) console.log(`${k.padEnd(6)} ${String(v.docs).padStart(5)} ${String(v.lidos).padStart(6)} ${String(v.semPdf).padStart(7)} ${String(v.semBloco).padStart(13)} ${String(v.protegido).padStart(9)}`);
})();
