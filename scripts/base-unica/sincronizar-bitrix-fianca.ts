// Base Única — Fase 4: lê o SPA de Seguro Fiança no Bitrix e confere, mês a
// mês, com o retrato do painel /seguro-fianca (entradas, aprovados, recusados,
// perdidos, convertidos). Com --gravar, grava na linha do tempo
// (producao_unificada, fonte='bitrix') — o mesmo que o cron
// /api/cron/base-unica-bitrix faz de hora em hora. Lógica em src/lib/baseUnica/bitrixFianca.ts.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/sincronizar-bitrix-fianca.ts [--gravar]
process.loadEnvFile(".env.local");

import { createServiceClient } from "@/lib/supabase/service";
import { gravarBitrixFianca, lerBitrixFianca } from "@/lib/baseUnica/bitrixFianca";

async function main() {
  const dados = await lerBitrixFianca();
  const supabase = createServiceClient();
  const { data: retratos } = await supabase.from("seguro_fianca_snapshots").select("competencia, payload").gte("competencia", "2026-07").order("competencia");
  console.log("mês | entradas (base/painel) | aprovados | recusados | perdidos | convertidos");
  for (const m of Object.keys(dados.porMes).sort()) {
    const k = (retratos ?? []).find((r) => r.competencia === m)?.payload?.kpis;
    const p = dados.porMes[m];
    const par = (a: number | undefined, b: number | undefined) => `${a ?? 0}/${b ?? "—"}${k && (a ?? 0) !== (b ?? 0) ? " ≠" : ""}`;
    console.log(
      `${m} | ${par(p.entradas, k?.total)} | ${par(p.aprovados, k?.aprovados?.total)} | ${par(p.recusados, k?.recusados?.total)} | ${par(p.perdidos, k?.perdidos?.total)} | ${par(p.convertidos, k?.convertidos?.total)}`
    );
  }
  console.log(`cards: ${dados.linhas.length} | sem empresa: ${dados.linhas.filter((l) => !dados.empresaPorCard.get(l.id)).length}`);
  if (!process.argv.includes("--gravar")) return console.log("\n(simulação — nada gravado; use --gravar)");
  console.log(await gravarBitrixFianca(supabase, dados));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
