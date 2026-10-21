// Só leitura: lê os funis de renovação do Bitrix (Fiança cat. 32 e RE cat. 34)
// e mostra os totais por mês para conferir com os painéis. Nada é gravado.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/_analisar-renovacoes-bitrix.ts
process.loadEnvFile(".env.local");
import { listarCardsRenovacaoFianca } from "@/lib/bitrix/renovacaoFianca";
import { listarRenovacoesRamosElementares } from "@/lib/ramos-elementares/fonteBitrix";

const cont = (xs: (string | null | undefined)[]) => {
  const o: Record<string, number> = {};
  for (const x of xs) o[x ?? "—"] = (o[x ?? "—"] ?? 0) + 1;
  return Object.entries(o)
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
};
async function main() {
  const f = await listarCardsRenovacaoFianca();
  console.log(`FIANÇA renovação (cat. 32): ${f.length} cards`);
  console.log("  entrada por mês: " + cont(f.map((c) => c.competencia)));
  console.log("  resultado: " + cont(f.map((c) => c.resultado)));
  console.log("  renovados por mês: " + cont(f.filter((c) => c.resultado === "Renovado").map((c) => c.dataResolucao?.slice(0, 7))));
  console.log("  perdidos por mês: " + cont(f.filter((c) => c.resultado === "Perdido").map((c) => c.dataResolucao?.slice(0, 7))));
  console.log("  vencimento por mês: " + cont(f.map((c) => c.fimVigenciaAnterior?.slice(0, 7))));
  console.log(`  com empresa: ${f.filter((c) => c.companyId).length} | com prêmio: ${f.filter((c) => c.premioLiquido).length} | seguradora: ${cont(f.map((c) => c.seguradora))}`);

  const r = await listarRenovacoesRamosElementares();
  console.log(`\nRE renovações (cat. 34 + cat. 22 marcadas): ${r.length} cards | categoria: ${cont(r.map((c) => String(c.categoria)))}`);
  console.log("  competência por mês: " + cont(r.map((c) => c.competencia)));
  console.log("  status: " + cont(r.map((c) => c.status)));
  console.log("  efetivados por mês do desfecho: " + cont(r.filter((c) => c.desfecho === "EFETIVADO").map((c) => c.dataDesfecho?.slice(0, 7))));
  console.log("  não efetivados por mês do desfecho: " + cont(r.filter((c) => c.desfecho === "NÃO EFETIVADO").map((c) => c.dataDesfecho?.slice(0, 7))));
  console.log("  fim vigência por mês: " + cont(r.map((c) => c.fimVigencia?.slice(0, 7))));
  console.log(`  com empresa: ${r.filter((c) => c.companyId).length} | com prêmio: ${r.filter((c) => c.premioTotal).length} | produto: ${cont(r.map((c) => c.produto))}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
