process.loadEnvFile(".env.local");
// Liga renovações da Tokio usando o "Relatório de Renovação" do portal (xlsx): Negócio/Item Anterior ↔ Negócio/Item Renovação,
// casados com o Negócio/Item escrito no PDF de cada apólice (erp_apolice_pdf_negocio_item). Só vínculo — não cria nem apaga documento.
// Uso: tsx scripts/erp/ligar-renovacao-tokio-relatorio.ts <arquivo.xls> [outro.xls ...] [--aplicar]
import * as XLSX from "xlsx";
import fs from "fs";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const APLICAR = process.argv.includes("--aplicar");
const arquivos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const s = (v: unknown) => String(v ?? "").trim();

async function main() {
  const { data: ni } = await sb.from("erp_apolice_pdf_negocio_item").select("documento_id,negocio,item").limit(20000);
  const porPar = new Map<string, Set<string>>();
  for (const r of ni ?? []) { const k = `${r.negocio}|${r.item}`; (porPar.get(k) ?? porPar.set(k, new Set()).get(k)!).add(r.documento_id as string); }

  // apólice anterior → documento(s) do ERP, pelo número da apólice (lote: vários números separados por ";")
  const porNumero = new Map<string, Set<string>>();
  const { data: seg } = await sb.from("erp_seguradoras").select("id").in("abreviacao", ["TOKI", "TOKIO"]);
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from("erp_documentos").select("id,numero_apolice").eq("tipo", "A").neq("situacao", "duplicado").in("seguradora_id", (seg ?? []).map((x) => x.id)).not("numero_apolice", "is", null).order("id").range(off, off + 999);
    for (const d of data ?? []) for (const t of String(d.numero_apolice).split(/[;,\s]+/)) { const k = t.replace(/\D/g, "").replace(/^0+/, ""); if (k.length >= 5) (porNumero.get(k) ?? porNumero.set(k, new Set()).get(k)!).add(d.id as string); }
    if ((data?.length ?? 0) < 1000) break;
  }
  const pares: { ant: string; ren: string; arq: string; situ: string }[] = [];
  for (const f of arquivos) {
    const wb = XLSX.read(fs.readFileSync(f));
    for (const n of wb.SheetNames) for (const r of XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[n], { defval: "" })) {
      const na = s(r["Negocio Anterior"]), ia = s(r["Item Anterior"]), nr = s(r["Negócio Renovação"]), ir = s(r["Item Renovação"]);
      if (na && ia && nr && ir) pares.push({ ant: s(r["Apólice Anterior"]).replace(/\D/g, "").replace(/^0+/, ""), ren: na === nr && ia === ir ? "" : `${nr}|${ir}`, arq: f.split(/[\\/]/).pop()!, situ: s(r["Situação da proposta"] || r["Motivo/Situação"]) });
    }
  }
  const st = { linhas: pares.length, ainda_nao_gerada: 0, sem_anterior_no_erp: 0, sem_renovada_no_erp: 0, ja_igual: 0, novo: 0, conflito: 0, ambiguo: 0 };
  const aplicar: { id: string; novo: string; antigo: string | null }[] = [];
  const docs = new Set<string>();
  for (const p of pares) {
    if (!p.ren || p.ren === "|") { st.ainda_nao_gerada++; continue; }
    const A = porNumero.get(p.ant), R = porPar.get(p.ren);
    if (!A?.size) { st.sem_anterior_no_erp++; continue; }
    if (!R?.size) { st.sem_renovada_no_erp++; continue; }
    if (A.size > 1 || R.size > 1) { st.ambiguo++; continue; }
    const a = [...A][0], r = [...R][0]; if (a === r) continue;
    docs.add(r);
    aplicar.push({ id: r, novo: a, antigo: null });
  }
  for (let i = 0; i < aplicar.length; i += 200) {
    const { data } = await sb.from("erp_documentos").select("id,documento_renovado_id").in("id", aplicar.slice(i, i + 200).map((x) => x.id));
    const m = new Map((data ?? []).map((d) => [d.id as string, d.documento_renovado_id as string | null]));
    for (const x of aplicar.slice(i, i + 200)) x.antigo = m.get(x.id) ?? null;
  }
  const novos = aplicar.filter((x) => !x.antigo), iguais = aplicar.filter((x) => x.antigo === x.novo), conf = aplicar.filter((x) => x.antigo && x.antigo !== x.novo);
  st.novo = novos.length; st.ja_igual = iguais.length; st.conflito = conf.length;
  console.log(JSON.stringify(st));
  if (!APLICAR) { console.log("(simulação; use --aplicar para gravar)"); return; }
  for (const x of [...novos, ...conf]) {
    if (x.antigo) await sb.from("erp_renovacao_ligacao_historico").insert({ documento_id: x.id, anterior_antigo_id: x.antigo, anterior_novo_id: x.novo, motivo: "Negócio/Item do relatório de renovação da Tokio (04/11/2026)" });
    await sb.from("erp_documentos").update({ documento_renovado_id: x.novo, renovacao_fonte: "relatorio_tokio", renovacao_nivel: 1, renovacao_lida_em: new Date().toISOString() }).eq("id", x.id);
  }
  console.log("gravados:", novos.length + conf.length);
}
main().catch((e) => { console.error("ERRO", e); process.exit(1); });
