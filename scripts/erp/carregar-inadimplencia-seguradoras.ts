// ERP O2 — inadimplência confirmada pelas seguradoras (e-mails Allianz, Pottencial, Alfa, Too) → erp_parcelas_inadimplencia.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-inadimplencia-seguradoras.ts [--gravar] [--desde 2026-10-14] [--seguradora ALLI,POTT]
process.loadEnvFile(".env.local");

import { createServiceClient } from "@/lib/supabase/service";
import { carregarInadimplenciaSeguradoras } from "@/lib/erp/inadimplenciaSeguradoras";

function arg(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] ?? "" : null;
}

async function main() {
  const gravar = process.argv.includes("--gravar");
  const desde = arg("--desde") ?? new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
  const apenas = (arg("--seguradora") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const rs = await carregarInadimplenciaSeguradoras(createServiceClient(), { desde, gravar, apenas: apenas.length ? apenas : undefined });
  for (const r of rs) {
    console.log(`${gravar ? "GRAVADO" : "SIMULAÇÃO"} · ${r.seguradora}: ${r.emails} e-mails · ${r.avisos} avisos · gravados ${r.gravados} · erros ${r.erros.length}`);
    for (const e of r.erros.slice(0, 5)) console.log("  erro:", e);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
