// ERP O2 — Fase 2: extratos/demonstrativos de comissão (Pottencial, Too, Tokio-resumo) do Gmail → ERP.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-extratos.ts
//        [--gravar] [--desde 2026-08-01] [--seguradora POTTENCIAL,TOO] [--max 40]
// Sem --gravar só simula (lista o que carregaria). Com --gravar também roda erp_cruzar_extratos().
process.loadEnvFile(".env.local");

import { createServiceClient } from "@/lib/supabase/service";
import { carregarExtratos } from "@/lib/erp/extratos";

function arg(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] ?? "" : null;
}

async function main() {
  const gravar = process.argv.includes("--gravar");
  const desde = arg("--desde") ?? "2026-08-01";
  const apenas = (arg("--seguradora") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const max = Number(arg("--max") ?? 40);
  const sb = createServiceClient();
  const resumos = await carregarExtratos(sb, { desde, gravar, apenas: apenas.length ? apenas : undefined, max });
  for (const r of resumos) {
    console.log(`${gravar ? "GRAVADO" : "SIMULAÇÃO"} · ${r.seguradora}: ${r.mensagens} e-mails desde ${desde} · extratos novos ${r.extratos_novos} (${r.linhas} linhas) · já carregados ${r.extratos_ja_carregados} · erros ${r.erros.length}`);
    for (const e of r.erros.slice(0, 10)) console.log(`  erro: ${e}`);
  }
  if (gravar) {
    const { data, error } = await sb.rpc("erp_cruzar_extratos");
    console.log("cruzamento:", error ? error.message : JSON.stringify(data));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
