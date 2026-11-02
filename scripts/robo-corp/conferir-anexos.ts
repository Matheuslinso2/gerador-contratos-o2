// Confere cada anexo (PDF) do Corp com o documento do ERP a que está ligado: seguradora do PDF x seguradora do documento e nº da apólice do ERP dentro do texto do PDF.
// Texto NATIVO do PDF (sem IA, sem custo). Grava em corp_anexos_conferencia. "seguradora_diferente" = o anexo é de OUTRO documento (bug do robô que abria a 1ª linha da busca).
// Com o nº de outro documento do ERP no texto do PDF (1 só candidato), guarda o provável dono em pertence_a_nosso_numero. Retomável. Ensaio por padrão; --gravar grava.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/conferir-anexos.ts [--gravar] [--todos] [--limite N]   (--todos: também os que não são apólice)
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
import { normNome } from "@/lib/erp/tarefaCadastro";

const GRAVAR = process.argv.includes("--gravar"), TODOS = process.argv.includes("--todos");
const limite = process.argv.includes("--limite") ? Number(process.argv[process.argv.indexOf("--limite") + 1]) : Infinity;
const sb = createServiceClient();
const dig = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
// seguradora no texto do PDF (as principais; só vale quando UMA aparece com clareza)
const SEG: [string, RegExp][] = [["TOKI", /tokio marine/i], ["PORT", /porto seguro|porto\s+seguros?\s+cia|portoseguro/i], ["POTT", /pottencial/i], ["ALLI", /allianz/i], ["YELU", /yelum|liberty seguros/i], ["ZURI", /zurich/i], ["MAPF", /mapfre/i], ["HDI", /\bhdi\b/i], ["ALF", /alfa seguradora|alfaseg/i], ["SUHA", /suhai/i], ["BRAS", /brasilcap/i], ["ICAT", /icatu/i], ["AZUL", /azul seguros|azul companhia/i], ["BRAD", /bradesco seguros|bradesco auto/i], ["SULA", /sul\s?am[eé]rica/i], ["ITAU", /ita[uú] seguros/i], ["TOO", /too seguros/i]];
const segDoTexto = (t: string): string | null => { const achadas = SEG.filter(([, re]) => re.test(t)).map(([k]) => k); return achadas.length === 1 ? achadas[0] : null; };
const ALIAS: Record<string, string[]> = { ALF: ["ALF", "ALFA", "ALFA_UNIF"], YELU: ["YELU", "ALL" /* Allianz? não */].slice(0, 1), TOKI: ["TOKI"], PORT: ["PORT"] };
const mesmaSeg = (erp: string | null, pdf: string | null) => !erp || !pdf || erp === pdf || (ALIAS[pdf] ?? [pdf]).includes(erp);

(async () => {
  const anexos: any[] = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.from("corp_anexos").select("id,nosso_numero,nome,apolice,storage_path,mime").order("id").range(de, de + 999); if (!TODOS) q = q.eq("apolice", true);
    const { data, error } = await q; if (error) throw new Error(error.message); anexos.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  const feitos = new Set<string>();
  for (let de = 0; ; de += 1000) { const { data } = await sb.from("corp_anexos_conferencia").select("anexo_id").order("anexo_id").range(de, de + 999); for (const x of data ?? []) feitos.add(x.anexo_id); if (!data || data.length < 1000) break; }
  const alvo = anexos.filter((a) => !feitos.has(a.id) && /pdf/i.test(a.mime ?? a.nome ?? "")).slice(0, limite);
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${alvo.length} anexos PDF a conferir (${feitos.size} já conferidos)`);
  const nns = [...new Set(alvo.map((a) => Number(a.nosso_numero)))];
  const docs = new Map<number, { numero_apolice: string | null; seg: string | null; nomes: string[] }>();
  for (const g of em(nns, 150)) { const { data, error: error0 } = await sb.from("erp_documentos").select("id,nosso_numero_corp,numero_apolice,locatario_id,seguradora:erp_seguradoras(abreviacao)").in("nosso_numero_corp", g);
    if (error0) throw new Error(error0.message);
    const locNome = new Map<string, string>(); const locIds = [...new Set((data ?? []).map((d) => d.locatario_id).filter(Boolean))] as string[];
    for (const gl of em(locIds, 150)) { const { data: ls } = await sb.from("locatarios").select("id,nome").in("id", gl); for (const l of ls ?? []) locNome.set(l.id, l.nome); }
    const ids = (data ?? []).map((d) => d.id); const partes = new Map<string, string[]>();
    if (ids.length) { const { data: its } = await sb.from("erp_documento_itens").select("id,documento_id").in("documento_id", ids); const itDoc = new Map((its ?? []).map((i) => [i.id, i.documento_id])); for (const gi of em([...itDoc.keys()], 150)) { const { data: ps } = await sb.from("erp_item_partes").select("item_id,nome").in("item_id", gi); for (const p of ps ?? []) { const d0 = itDoc.get(p.item_id)!; (partes.get(d0) ?? partes.set(d0, []).get(d0)!).push(p.nome); } } }
    for (const d of data ?? []) docs.set(Number(d.nosso_numero_corp), { numero_apolice: d.numero_apolice, seg: (d as any).seguradora?.abreviacao ?? null, nomes: [locNome.get(d.locatario_id as string), ...(partes.get(d.id) ?? [])].filter(Boolean) as string[] }); }
  const cont: Record<string, number> = {}; const linhas: any[] = []; let feito = 0;
  const trabalhar = async (a: any) => {
    const doc = docs.get(Number(a.nosso_numero));
    const base = { anexo_id: a.id, nosso_numero: a.nosso_numero, seguradora_erp: doc?.seg ?? null, numero_erp: doc?.numero_apolice ?? null, titular_erp: doc?.nomes?.[0] ?? null, tipo_anexo: a.apolice ? "apolice" : "outro" };
    let r: any;
    try {
      const { data: blob } = await sb.storage.from("corp-anexos").download(a.storage_path);
      if (!blob) r = { ...base, resultado: "sem_arquivo" };
      else {
        const { t } = await textoDoPdf(Buffer.from(await blob.arrayBuffer()), []);
        const texto = (t ?? "").replace(/\s+/g, " ");
        if (texto.length < 80) r = { ...base, resultado: "sem_texto" };
        else {
          const segPdf = segDoTexto(texto); const nErp = doc?.numero_apolice ? dig(doc.numero_apolice) : "";
          const soDig = texto.replace(/[^\d]/g, " ").split(/\s+/); const juntos = texto.replace(/[.\-\/ ]/g, "");
          const temNumero = nErp.length >= 5 && (juntos.includes(nErp) || soDig.some((x) => dig(x) === nErp));
          const tn = normNome(texto); const temNome = (doc?.nomes ?? []).some((n) => { const k = normNome(n); return k.split(" ").length >= 2 && tn.includes(k); });
          // seguradora do PDF diferente = anexo de outro documento; nº da apólice OU nome do titular no texto = confere (proposta/endosso nem sempre trazem o nº da apólice)
          const resultado = !mesmaSeg(doc?.seg ?? null, segPdf) ? "seguradora_diferente" : temNumero || temNome ? "confere" : "numero_ausente";
          r = { ...base, resultado, seguradora_pdf: segPdf, numero_no_pdf: temNumero, titular_no_pdf: temNome };
          if (resultado !== "confere") {
            // provável dono: documento do ERP (da seguradora do PDF) cujo nº da apólice aparece no texto
            const cands = [...new Set((texto.match(/\d[\d.\-\/]{5,22}\d/g) ?? []).map(dig).filter((x) => x.length >= 6 && x.length <= 14))].slice(0, 40);
            if (cands.length) { const { data: ds } = await sb.from("erp_documentos").select("nosso_numero_corp,numero_apolice").in("numero_apolice", cands).neq("tipo", "X").limit(5); const u = [...new Set((ds ?? []).map((x) => x.nosso_numero_corp))].filter((n) => String(n) !== a.nosso_numero); if (u.length === 1) { r.pertence_a_nosso_numero = String(u[0]); r.pertence_a_motivo = "nº da apólice do documento aparece no PDF"; } }
          }
        }
      }
    } catch (e) { r = { ...base, resultado: "sem_arquivo", pertence_a_motivo: `erro: ${(e as Error).message}`.slice(0, 120) }; }
    cont[r.resultado] = (cont[r.resultado] ?? 0) + 1; linhas.push(r);
    if (++feito % 200 === 0) console.log(`  ${feito}/${alvo.length} ${JSON.stringify(cont)}`);
    if (GRAVAR && linhas.length >= 50) { const lote = linhas.splice(0, linhas.length); const { error } = await sb.from("corp_anexos_conferencia").upsert(lote, { onConflict: "anexo_id" }); if (error) console.log("gravar:", error.message); }
  };
  let i = 0; await Promise.all(Array.from({ length: 16 }, async () => { while (i < alvo.length) await trabalhar(alvo[i++]); }));
  if (GRAVAR && linhas.length) { const { error } = await sb.from("corp_anexos_conferencia").upsert(linhas, { onConflict: "anexo_id" }); if (error) console.log("gravar:", error.message); }
  console.log(`resultado: ${JSON.stringify(cont)}`);
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
