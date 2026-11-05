// Carrega os endossos lidos no portal Tokio (consulta única por idepol) em erp_portal_tokio_endossos.
// Entrada: tokio-endossos.json em Downloads. Uso: npx tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-portal-tokio-endossos.ts
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const carga = `tokio-end-${new Date().toISOString().slice(0, 16)}`;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const br = (v: unknown) => { const m = typeof v === "string" ? v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null; return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

async function main() {
  const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), "Downloads", "tokio-endossos.json"), "utf8")) as { coletado_em: string; itens: Record<string, unknown>[] };
  // idepol → nº da apólice, pela carga de apólices
  const mapa = new Map<number, string>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from("erp_portal_tokio_apolices").select("idepol, apolice").not("idepol", "is", null).order("id").range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) mapa.set(Number(r.idepol), String(r.apolice));
    if ((data ?? []).length < 1000) break;
  }
  const vistos = new Set<string>();
  const linhas = j.itens.map((x) => ({
    carga, coletado_em: j.coletado_em, idepol: Number(x.idepol), apolice: mapa.get(Number(x.idepol)) ?? null,
    endosso: num(x.endosso), tipo_endosso: (x.tipoEndosso as string) ?? null, tipo_movimento: (x.tipoMovimento as string) ?? null,
    dt_emissao: br(x.dtEmissao), vigencia_inicio: br(x.inicio), vigencia_fim: br(x.fim), premio_liquido: num(x.premioLiquido),
    premio_total: num(x.premioTotal), comissao_pct: num(x.comissaoPct), valor_comissao: num(x.valorComissao),
    situacao: (x.situacao as string) ?? null, numoper: num(x.numoper), bruto: x,
  })).filter((l) => { const k = [l.idepol, l.endosso, l.numoper].join("|"); if (vistos.has(k)) return false; vistos.add(k); return true; });
  for (let i = 0; i < linhas.length; i += 400) {
    const { error } = await sb.from("erp_portal_tokio_endossos").insert(linhas.slice(i, i + 400));
    if (error) throw new Error(error.message);
  }
  console.log("carga", carga, "gravada:", linhas.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
