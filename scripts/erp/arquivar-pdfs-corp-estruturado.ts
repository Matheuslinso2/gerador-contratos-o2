// ERP O2 — 01/11/2026: os 2 PDFs do Corp ("Extrato Completo para Renovação" e "endossos corp") gravados ESTRUTURADOS em
// erp_corp_export_linhas (no lugar do texto linha a linha), a partir do JSON já lido dos PDFs (parse.mjs → docs.json; e1.cjs → end_rows.json).
// relatorio 'extrato_completo_renovacao' = 1 linha por documento (todos os campos + parcelas); 'extrato_completo_renovacao_parcela' = 1 por
// parcela (chave para parcela_id); 'endossos_corp' = 1 por registro. Fonte corp_export, nível 8. Lote para desfazer.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/arquivar-pdfs-corp-estruturado.ts <lote> <docs.json> <end_rows.json>
process.loadEnvFile(".env.local");
import { readFileSync } from "node:fs";

const iso = (s: unknown) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(String(s ?? "").trim());
  return m ? `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2]}-${m[1]}` : s ?? null;
};

(async () => {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const sb = createServiceClient();
  const [lote, docsPath, endPath] = process.argv.slice(2);
  const docs = JSON.parse(readFileSync(docsPath, "utf8")) as Record<string, any>[];
  const ends = JSON.parse(readFileSync(endPath, "utf8")) as Record<string, any>[];
  const regs: Record<string, unknown>[] = [];
  let n = 0;
  for (const d of docs) {
    const dados = { ...d, nosso_n: d.nosso, vig_ini: iso(d.vig_ini), vig_fim: iso(d.vig_fim),
      parcelas: (d.parcelas ?? []).map((p: any) => ({ ...p, venc: iso(p.venc), quit: iso(p.quit) })) };
    regs.push({ lote, relatorio: "extrato_completo_renovacao", arquivo: "Extrato Completo para Renovacao.pdf", linha_n: ++n, dados, apolice: d.apolice ?? null, endosso: d.ult_end != null ? String(d.ult_end) : null, cic: d.cpf ?? null });
  }
  n = 0;
  for (const d of docs) for (const p of d.parcelas ?? []) {
    regs.push({ lote, relatorio: "extrato_completo_renovacao_parcela", arquivo: "Extrato Completo para Renovacao.pdf", linha_n: ++n,
      dados: { nosso_n: d.nosso, apolice: d.apolice, ...p, venc: iso(p.venc), quit: iso(p.quit) }, apolice: d.apolice ?? null, parcela: String(p.n), cic: d.cpf ?? null });
  }
  n = 0;
  for (const e of ends) {
    regs.push({ lote, relatorio: "endossos_corp", arquivo: "endossos corp.pdf", linha_n: ++n, dados: { ...e, nosso_n: e.nosso, dt: iso(e.dt), ini: iso(e.ini), fim: iso(e.fim) } });
  }
  for (let k = 0; k < regs.length; k += 500) {
    const { error } = await sb.from("erp_corp_export_linhas").upsert(regs.slice(k, k + 500), { onConflict: "relatorio,arquivo,linha_n" });
    if (error) throw new Error(error.message);
  }
  console.log(JSON.stringify({ documentos: docs.length, parcelas: regs.filter((r) => r.relatorio === "extrato_completo_renovacao_parcela").length, endossos: ends.length }));
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
