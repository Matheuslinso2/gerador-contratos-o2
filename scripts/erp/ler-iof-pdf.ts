// Lê o IOF dentro do PDF da apólice para os vigentes com IOF faltando (Matheus 29/10: "pegar a apólice e verificar o IOF correto").
// Ensaio por padrão: mostra o que achou; --gravar grava o IOF do PDF (e o total quando o PDF o traz) no documento.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ler-iof-pdf.ts [--amostra N] [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const AMOSTRA = Number(arg("amostra") ?? 1e9);
const sb = createServiceClient();

/** IOF em reais dentro do texto: linha com IOF e um valor plausível (entre 0,38% e 12% do prêmio líquido). */
function acharIof(t: string, liquido: number): number | null {
  const valor = (s: string) => Number(s.replace(/[.]/g, "").replace(",", "."));
  for (const l of t.split(/\r?\n/)) {
    if (!/i\.?o\.?f/i.test(l)) continue;
    for (const m of l.matchAll(/(\d{1,3}(?:\.?\d{3})*,\d{2})/g)) {
      const v = valor(m[1]);
      if (v > 0 && v >= liquido * 0.0038 && v <= liquido * 0.12) return v;
    }
  }
  return null;
}
(async () => {
  const { data: docs } = await sb.from("erp_documentos")
    .select("id, nosso_numero, nosso_numero_corp, numero_apolice, premio_liquido, premio_total, premio_adicional, iof, ramo:erp_ramos!inner(produto, nome)")
    .eq("situacao", "vigente").in("tipo", ["A", "F"]).or("iof.is.null,iof.eq.0").gt("premio_liquido", 0)
    .in("ramo.produto", ["fianca", "automovel", "incendio", "condominio", "portateis", "vida"]).limit(400);
  const alvo = (docs ?? []).slice(0, AMOSTRA) as unknown as { id: string; nosso_numero: number; nosso_numero_corp: number | null; numero_apolice: string | null; premio_liquido: number; premio_total: number | null; premio_adicional: number | null; ramo: { produto: string; nome: string } }[];
  console.log(`${alvo.length} documentos vigentes sem IOF (${GRAVAR ? "GRAVANDO" : "ENSAIO"})`);
  let ok = 0, sem = 0, revisar = 0;
  for (const d of alvo) {
    const { data: ax } = await sb.from("erp_documento_anexos").select("storage_path, nome_arquivo").eq("documento_id", d.id).limit(5);
    let caminho: { bucket: string; path: string; nome: string } | null = null;
    for (const a of ax ?? []) if (a.storage_path) { caminho = { bucket: "anexos-documentos", path: a.storage_path, nome: a.nome_arquivo ?? "" }; break; }
    if (!caminho && d.nosso_numero_corp) {
      const { data: ca } = await sb.from("corp_anexos").select("storage_path, nome").eq("nosso_numero", d.nosso_numero_corp).limit(8);
      const c = (ca ?? []).find((x) => /\.pdf$/i.test(x.nome ?? "")) ?? (ca ?? [])[0];
      if (c?.storage_path) caminho = { bucket: "corp-anexos", path: c.storage_path, nome: c.nome ?? "" };
    }
    if (!caminho) { console.log(`${d.nosso_numero}\t${d.ramo.produto}\tsem PDF`); continue; }
    const { data: blob, error } = await sb.storage.from(caminho.bucket).download(caminho.path);
    if (error || !blob) { console.log(`${d.nosso_numero}\t${d.ramo.produto}\terro baixando ${caminho.bucket}: ${error?.message}`); continue; }
    const { t, protegido } = await textoDoPdf(Buffer.from(await blob.arrayBuffer()), []);
    if (!t) { console.log(`${d.nosso_numero}\t${d.ramo.produto}\t${protegido ? "PDF protegido" : "PDF sem texto"}`); continue; }
    const iof = acharIof(t, Number(d.premio_liquido));
    if (iof === null) { sem++; console.log(`${d.nosso_numero}	${d.ramo.produto}	liq ${d.premio_liquido}	PDF lido, IOF não identificado`); continue; }
    const total = Math.round((Number(d.premio_liquido) + iof + Number(d.premio_adicional ?? 0)) * 100) / 100;
    console.log(`${d.nosso_numero}	${d.ramo.produto}	liq ${d.premio_liquido}	IOF do PDF ${iof} (${(iof / Number(d.premio_liquido) * 100).toFixed(2)}%)	total ${total}`);
    // só grava o que bate com uma alíquota conhecida (7,38% ou 0,38%); o resto (adicional de fracionamento, linha errada) vai para revisão
    const razao = iof / Number(d.premio_liquido);
    const confiavel = Math.abs(razao - 0.0738) <= 0.0008 || Math.abs(razao - 0.0038) <= 0.0004;
    if (!confiavel) { revisar++; console.log(`   ↳ REVISAR: fora das alíquotas conhecidas, não grava`); continue; }
    ok++;
    if (GRAVAR) { const { error: e } = await sb.from("erp_documentos").update({ iof, premio_total: total }).eq("id", d.id); if (e) throw new Error(e.message); }
  }
  console.log(`
IOF achado no PDF: ${ok} | para revisar (fora da alíquota): ${revisar} | PDF lido sem IOF identificado: ${sem}${GRAVAR ? " | gravado" : " | (ensaio, nada gravado)"}`);
})();
