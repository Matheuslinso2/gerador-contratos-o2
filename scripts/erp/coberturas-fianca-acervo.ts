// Coberturas contratadas de FIANÇA no documento do ERP (erp_documento_coberturas), a partir das coberturas JÁ LIDAS dos PDFs de apólice do acervo
// (apolice_documentos.coberturas, situação 'certa', ligadas ao documento pelo Nosso nº do Corp). Fonte = PDF da seguradora (nível 1), linha a linha
// com a origem (fonte_ref = id do PDF no acervo). Nomes padronizados. Lote identificável (desfazer: --desfazer). Ensaio por padrão.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/coberturas-fianca-acervo.ts [--gravar] [--desfazer] [--lote NOME] [--amostra N]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { padronizarCoberturaFianca } from "@/lib/erp/coberturasFianca";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const LOTE = arg("lote") ?? "COBERTURAS-FIANCA-ACERVO-20261031";
const sb = createServiceClient();
const padronizar = padronizarCoberturaFianca;

async function todas<T>(tabela: string, cols: string, filtro: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(sb.from(tabela).select(cols)).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  if (process.argv.includes("--desfazer")) {
    const { error, count } = await sb.from("erp_documento_coberturas").delete({ count: "exact" }).eq("lote", LOTE);
    if (error) throw new Error(error.message);
    console.log(`desfeito o lote ${LOTE}: ${count} linhas`); return;
  }
  const docs = await todas<any>("erp_documentos", "id,nosso_numero_corp,vigencia_inicio,seguradora:erp_seguradoras!inner(abreviacao),ramo:erp_ramos!inner(produto)", (q) => q.eq("ramo.produto", "fianca").in("tipo", ["A", "F"]).not("nosso_numero_corp", "is", null).order("id"));
  const pdfs = await todas<any>("apolice_documentos", "id,nosso_numero,coberturas,vigencia_inicio,lido_em", (q) => q.eq("produto", "fianca").eq("situacao", "certa").not("nosso_numero", "is", null).order("id"));
  const porNn = new Map<string, any[]>();
  for (const p of pdfs) { if (!Array.isArray(p.coberturas) || !p.coberturas.length) continue; (porNn.get(String(p.nosso_numero)) ?? porNn.set(String(p.nosso_numero), []).get(String(p.nosso_numero))!).push(p); }
  const jaTem = new Set<string>();
  for (const x of await todas<any>("erp_documento_coberturas", "documento_id", (q) => q.eq("fonte", "pdf").eq("ordem", 1))) jaTem.add(x.documento_id);

  const porSeg: Record<string, { docs: number; comPdf: number; gravados: number; jaTinha: number; semNomePadrao: number; linhas: number }> = {};
  const naoMapeados = new Map<string, number>();
  const linhasTodas: any[] = []; let amostra = 0; const maxAmostra = Number(arg("amostra") ?? 5);
  for (const d of docs) {
    const s = (porSeg[d.seguradora.abreviacao] ??= { docs: 0, comPdf: 0, gravados: 0, jaTinha: 0, semNomePadrao: 0, linhas: 0 });
    s.docs++;
    const cands = porNn.get(String(d.nosso_numero_corp));
    if (!cands?.length) continue;
    s.comPdf++;
    if (jaTem.has(d.id)) { s.jaTinha++; continue; }
    // o PDF mais recente do mesmo documento (o acervo pode ter a apólice e um endosso/renovação com o mesmo nosso nº)
    const p = cands.sort((a, b) => String(b.lido_em).localeCompare(String(a.lido_em)))[0];
    const linhas: any[] = []; const vistos = new Set<string>(); let ordem = 0;
    for (const c of p.coberturas as any[]) {
      const orig = String(c.cobertura ?? "").trim(); if (!orig) continue;
      const pad = padronizar(orig);
      if (!pad) { naoMapeados.set(orig, (naoMapeados.get(orig) ?? 0) + 1); s.semNomePadrao++; }
      const nome = pad?.nome ?? orig;
      if (vistos.has(nome)) continue; vistos.add(nome);
      linhas.push({ documento_id: d.id, ordem: ++ordem, nome, nome_original: orig, tipo: pad?.tipo ?? "adicional", lmi: c.lmi ?? null, premio: null, verba: c.verba ?? null, franquia: null, fonte: "pdf", fonte_ref: p.id, nivel: 1, lote: LOTE });
    }
    if (!linhas.length) continue;
    s.gravados++; s.linhas += linhas.length; linhasTodas.push(...linhas);
    if (!GRAVAR && amostra < maxAmostra) { amostra++; console.log(`\n${d.seguradora.abreviacao} doc ${d.id.slice(0, 8)}:`); for (const l of linhas) console.log(`  [${l.tipo}] ${l.nome}${l.nome !== l.nome_original ? ` (${l.nome_original.slice(0, 40)})` : ""} | LMI ${l.lmi ?? "—"} | verba ${l.verba ?? "—"}`); }
  }
  console.log(`\n${GRAVAR ? "GRAVANDO" : "ENSAIO"} — lote ${LOTE}`);
  for (const [k, v] of Object.entries(porSeg)) console.log(`${k}: documentos ${v.docs} | com PDF do acervo com coberturas ${v.comPdf} | a gravar ${v.gravados} (${v.linhas} linhas) | já tinham ${v.jaTinha} | linhas sem nome padrão ${v.semNomePadrao}`);
  console.log(`total: ${linhasTodas.length} linhas em ${new Set(linhasTodas.map((l) => l.documento_id)).size} documentos`);
  if (naoMapeados.size) console.log("nomes sem padrão:", [...naoMapeados].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k.slice(0, 50)} (${v})`).join(" | "));
  if (!GRAVAR) return;
  for (let i = 0; i < linhasTodas.length; i += 200) {
    const { error } = await sb.from("erp_documento_coberturas").upsert(linhasTodas.slice(i, i + 200), { onConflict: "documento_id,fonte,ordem" });
    if (error) throw new Error(error.message);
  }
  console.log(`gravadas ${linhasTodas.length} linhas`);
})();
