// Renovações sem cotação × linhas das planilhas já lidas (erp_planilha_registro). Só leitura. Saída: renovacoes-re/sem-cotacao-x-planilhas-0611.csv
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
async function main() {
  const { data: v } = await sb.from("erp_renovacoes_sem_cotacao_v").select("documento_id, numero_apolice, imobiliaria, seguradora, vigencia_inicio, vigencia_fim").range(0, 999);
  const docs = (v ?? []) as any[];
  const { data: dd } = await sb.from("erp_documentos").select("id, locatario_id, documento_renovado_id, renovacao_inferida_id").in("id", docs.map((d) => d.documento_id));
  const antIds = (dd ?? []).map((d: any) => d.documento_renovado_id ?? d.renovacao_inferida_id).filter(Boolean);
  const { data: ants } = await sb.from("erp_documentos").select("id, numero_apolice").in("id", antIds);
  const { data: locs } = await sb.from("locatarios").select("id, cpf").in("id", (dd ?? []).map((d: any) => d.locatario_id).filter(Boolean));
  const antNum = new Map((ants ?? []).map((a: any) => [a.id, a.numero_apolice as string]));
  const cpfLoc = new Map((locs ?? []).map((l: any) => [l.id, dig(l.cpf)]));
  const info = new Map((dd ?? []).map((d: any) => [d.id, { ant: antNum.get(d.documento_renovado_id ?? d.renovacao_inferida_id) ?? "", cpf: cpfLoc.get(d.locatario_id) ?? "" }]));
  const nums = [...new Set(docs.flatMap((d) => [d.numero_apolice, info.get(d.documento_id)?.ant]).filter(Boolean))] as string[];
  const reg: any[] = [];
  for (let i = 0; i < nums.length; i += 100) {
    const lote = nums.slice(i, i + 100);
    for (const col of ["apolice", "apolice_anterior"]) {
      const { data } = await sb.from("erp_planilha_registro").select("arquivo_id, arquivo_nome, aba, linha_n, aba_tipo, status, orcamento, apolice, apolice_anterior, locatario_doc, segurado, seguradora, fim_vigencia").in(col, lote).range(0, 4999);
      reg.push(...(data ?? []));
    }
  }
  const porApolice = new Map<string, any[]>();
  for (const r of reg) for (const k of [r.apolice, r.apolice_anterior].filter(Boolean)) { const a = porApolice.get(k) ?? []; if (!a.includes(r)) a.push(r); porApolice.set(k, a); }
  const linhas = ["Código O2 do documento;Nº da apólice (nova);Nº da apólice anterior;Imobiliária;Seguradora;Início da vigência;Arquivo da planilha;Aba;Linha;Status na planilha;Orçamento na planilha"];
  let com = 0, sem = 0; const semLista: any[] = [];
  for (const d of docs) {
    const i = info.get(d.documento_id)!;
    const achados = [...new Set([...(porApolice.get(d.numero_apolice) ?? []), ...(i.ant ? porApolice.get(i.ant) ?? [] : [])])];
    if (!achados.length) { sem++; semLista.push(d); linhas.push([d.documento_id, d.numero_apolice, i.ant, d.imobiliaria, d.seguradora, d.vigencia_inicio, "", "", "", "NÃO ACHADO por apólice", ""].map(csv).join(";")); continue; }
    com++;
    for (const r of achados) linhas.push([d.documento_id, d.numero_apolice, i.ant, d.imobiliaria, d.seguradora, d.vigencia_inicio, r.arquivo_nome, r.aba, r.linha_n, r.status, r.orcamento].map(csv).join(";"));
  }
  fs.writeFileSync(path.resolve(process.cwd(), "..", "renovacoes-re", "sem-cotacao-x-planilhas-0611.csv"), "\ufeff" + linhas.join("\n"));
  console.log(`193 sem cotação: ${docs.length} | com linha de planilha por Nº de apólice: ${com} | sem linha por apólice: ${sem}`);
  const g: Record<string, number> = {}; for (const d of semLista) { const k = `${String(d.vigencia_inicio).slice(0, 7)} ${d.imobiliaria}`; g[k] = (g[k] ?? 0) + 1; }
  console.log("sem linha, por início de vigência e imobiliária:", JSON.stringify(Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 12)));
}
main().catch((e) => { console.error(e); process.exit(1); });
