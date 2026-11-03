// Lista de revisão (SÓ LEITURA do banco): apólices em que o estipulante escrito no PDF da seguradora (apolice_documentos) é OUTRA empresa que a imobiliária principal do ERP (Corp).
// Mostra, para cada uma, o que as outras fontes dizem (produtores do Corp, fatura, repasse) e se há confirmação independente do PDF. Sem dados de cliente (só imobiliárias e nº de apólice).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/revisao-estipulante-pdf-corp.ts [saida.xlsx]
process.loadEnvFile(".env.local");
import * as XLSX from "xlsx";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const em = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
async function todas<T>(tabela: string, cols: string, filtro?: (q: any) => any): Promise<T[]> { const out: T[] = []; for (let de = 0; ; de += 1000) { let q: any = sb.from(tabela).select(cols).order("id").range(de, de + 999); if (filtro) q = filtro(q); const { data, error } = await q; if (error) throw new Error(`${tabela}: ${error.message}`); out.push(...(data ?? [])); if (!data || data.length < 1000) break; } return out; }

(async () => {
  const ac = await todas<any>("apolice_documentos", "id,nosso_numero,seguradora,numero_apolice,estipulante_nome,estipulante_documento", (q) => q.not("estipulante_nome", "is", null));
  const docs = new Map<string, any>();
  for (const g of em(ac.map((a) => Number(a.nosso_numero)).filter(Boolean), 150)) { const { data } = await sb.from("erp_documentos").select("id,nosso_numero_corp,numero_apolice,imobiliaria_principal_id").in("nosso_numero_corp", g); for (const d of data ?? []) docs.set(String(d.nosso_numero_corp), d); }
  const imobs = await todas<any>("imobiliarias", "id,nome,cnpj"); const imob = new Map(imobs.map((i) => [i.id, i]));
  const porCnpj = new Map<string, any[]>(); for (const i of imobs) { const c = dig(i.cnpj); if (c.length >= 11) (porCnpj.get(c) ?? porCnpj.set(c, []).get(c)!).push(i); }
  const lista = ac.map((a) => { const d = docs.get(String(a.nosso_numero)); const i = d?.imobiliaria_principal_id ? imob.get(d.imobiliaria_principal_id) : null; return { a, d, i, e: dig(a.estipulante_documento), ic: dig(i?.cnpj) }; }).filter((x) => x.d && x.i && x.e && x.ic && x.e !== x.ic);
  const ids = lista.map((x) => x.d.id);
  const prod = new Map<string, any[]>(), fat = new Map<string, Set<string>>(), rep = new Map<string, Set<string>>();
  for (const g of em(ids)) {
    const { data: ps } = await sb.from("erp_documento_produtores").select("id,documento_id,imobiliaria_id,agente,produtor_corp_nome").in("documento_id", g); for (const p of ps ?? []) (prod.get(p.documento_id) ?? prod.set(p.documento_id, []).get(p.documento_id)!).push(p);
    const { data: fi } = await sb.from("erp_fatura_itens").select("documento_id,fatura_mes_id").in("documento_id", g);
    const meses = [...new Set((fi ?? []).map((x) => x.fatura_mes_id))]; const fm = new Map<string, string>(); for (const gm of em(meses)) { const { data: ms } = await sb.from("erp_fatura_meses").select("id,fatura_id").in("id", gm); for (const m of ms ?? []) fm.set(m.id, m.fatura_id); }
    const fatIds = [...new Set([...fm.values()])]; const fi2 = new Map<string, string>(); for (const gf of em(fatIds)) { const { data: fs } = await sb.from("erp_faturas").select("id,imobiliaria_id").in("id", gf); for (const f of fs ?? []) fi2.set(f.id, f.imobiliaria_id); }
    for (const x of fi ?? []) { const im = fi2.get(fm.get(x.fatura_mes_id) ?? ""); if (im) (fat.get(x.documento_id) ?? fat.set(x.documento_id, new Set()).get(x.documento_id)!).add(im); }
    const prodIds = (ps ?? []).map((p) => p.id); const pDoc = new Map((ps ?? []).map((p) => [p.id, p.documento_id]));
    for (const gp of em(prodIds)) { const { data: rs } = await sb.from("erp_repasses").select("documento_produtor_id,imobiliaria_id").in("documento_produtor_id", gp); for (const r of rs ?? []) if (r.imobiliaria_id) { const d = pDoc.get(r.documento_produtor_id)!; (rep.get(d) ?? rep.set(d, new Set()).get(d)!).add(r.imobiliaria_id); } }
  }
  const linhas = lista.map(({ a, d, i, e, ic }) => {
    const pdfIds = (porCnpj.get(e) ?? []).map((x) => x.id); const nomes = (s: Iterable<string>) => [...s].map((id) => imob.get(id)?.nome ?? "?").join(" | ");
    const nosProd = (prod.get(d.id) ?? []).some((p) => pdfIds.includes(p.imobiliaria_id)); const naFatura = [...(fat.get(d.id) ?? [])].some((x) => pdfIds.includes(x)); const noRepasse = [...(rep.get(d.id) ?? [])].some((x) => pdfIds.includes(x));
    const conf = [naFatura ? "fatura" : "", noRepasse ? "repasse" : "", nosProd ? "produtor do Corp" : ""].filter(Boolean);
    return { "Nosso nº do Corp": a.nosso_numero, "Seguradora": a.seguradora, "Nº da apólice": a.numero_apolice, "Imobiliária principal no ERP (Corp)": i.nome, "CNPJ no ERP": i.cnpj, "Estipulante no PDF": a.estipulante_nome, "CNPJ do estipulante no PDF": a.estipulante_documento, "Estipulante do PDF existe no cadastro de imobiliárias?": pdfIds.length ? "Sim" : "Não", "Produtores do Corp neste documento": (prod.get(d.id) ?? []).map((p) => p.produtor_corp_nome ?? imob.get(p.imobiliaria_id)?.nome ?? "?").join(" | "), "Fatura em nome de": nomes(fat.get(d.id) ?? []), "Repasse para": nomes(rep.get(d.id) ?? []), "Confirmam o estipulante do PDF": conf.join(" + ") || "NENHUMA (revisar)", "Precisa de revisão?": conf.length ? "Não, o PDF é confirmado" : "SIM" };
  }).sort((x, y) => String(y["Precisa de revisão?"]).localeCompare(String(x["Precisa de revisão?"])) || String(x["Seguradora"]).localeCompare(String(y["Seguradora"])));
  const rev = linhas.filter((l) => l["Precisa de revisão?"] === "SIM");
  const wb = XLSX.utils.book_new();
  const resumo = [["Estipulante do PDF x imobiliária principal do Corp"], ["Apólices com estipulante lido no PDF e CNPJ diferente da imobiliária principal do ERP", linhas.length], ["Confirmadas por fatura, repasse ou produtor do Corp (o PDF vale)", linhas.length - rev.length], ["SEM confirmação independente (revisar)", rev.length], ["Regra: o PDF da seguradora é a fonte de maior nível; esta lista só aponta onde nenhuma outra fonte o confirma."]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rev), "Revisar");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Todas as divergentes");
  const saida = process.argv[2] ?? path.join("..", "erp-o2", "REVISAO-ESTIPULANTE-PDF-X-CORP.xlsx");
  XLSX.writeFile(wb, saida);
  console.log(`divergentes: ${linhas.length}; confirmadas: ${linhas.length - rev.length}; a revisar: ${rev.length}; arquivo: ${saida}`);
  const porSeg: Record<string, number> = {}; for (const l of rev) porSeg[String(l["Seguradora"])] = (porSeg[String(l["Seguradora"])] ?? 0) + 1; console.log("a revisar por seguradora:", JSON.stringify(porSeg));
  console.log("estipulante sem cadastro (a revisar):", rev.filter((l) => l["Estipulante do PDF existe no cadastro de imobiliárias?"] === "Não").length);
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
