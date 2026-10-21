// Só leitura: mostra, mês a mês, o que as abas de renovação das planilhas
// congeladas trazem (status, meses das datas, repetição entre meses), para
// definir a regra de contagem antes de importar. Nada é gravado.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/_analisar-renovacoes-planilhas.ts
process.loadEnvFile(".env.local");
import { lerRenovacoesFiancaPlanilhas, lerRenovacoesRePlanilhas } from "./_renovacoes-planilhas";

const cont = (xs: (string | null)[]) => {
  const o: Record<string, number> = {};
  for (const x of xs) o[x ?? "—"] = (o[x ?? "—"] ?? 0) + 1;
  return Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
};
async function main() {
  for (const [rotulo, ler] of [["FIANÇA", lerRenovacoesFiancaPlanilhas], ["RE", lerRenovacoesRePlanilhas]] as const) {
    const linhas = await ler("2025-11", "2026-10");
    console.log(`\n==== ${rotulo}: ${linhas.length} linhas`);
    const porComp = new Map<string, typeof linhas>();
    for (const l of linhas) {
      if (!porComp.has(l.comp)) porComp.set(l.comp, []);
      porComp.get(l.comp)!.push(l);
    }
    for (const [comp, ls] of [...porComp].sort()) {
      console.log(`\n${comp} | ${ls[0].arquivoNome} | aba ${ls[0].aba} | ${ls.length} linhas`);
      console.log("  status: " + cont(ls.map((l) => l.status)));
      console.log("  padrão: " + cont(ls.map((l) => l.statusPadrao)));
      console.log("  mês fim vig: " + cont(ls.map((l) => l.fimVigencia?.slice(0, 7) ?? null)));
      console.log("  mês receb/envio: " + cont(ls.map((l) => l.dataRecebimento?.slice(0, 7) ?? null)));
      console.log("  mês efetivação: " + cont(ls.map((l) => l.dataEfetivacao?.slice(0, 7) ?? null)));
      console.log(`  com imob: ${ls.filter((l) => l.imobiliaria).length} | com apólice: ${ls.filter((l) => l.apolice).length} | prêmio>0: ${ls.filter((l) => l.premio).length} | produto: ${cont(ls.map((l) => l.produto))}`);
    }
    const vistos = new Map<string, string[]>();
    for (const l of linhas) if (l.apolice) vistos.set(l.apolice, [...(vistos.get(l.apolice) ?? []), l.comp]);
    const rep = [...vistos.values()].filter((v) => new Set(v).size > 1);
    console.log(`\napólices em mais de um mês: ${rep.length} de ${vistos.size} (ex.: ${rep.slice(0, 8).map((v) => v.join(">")).join(" | ")})`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
