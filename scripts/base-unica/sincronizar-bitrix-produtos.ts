// Base Única — cotações de Capitalização, Automóvel e Ramos Elementares do
// Bitrix: confere mês a mês com o retrato do painel de cada produto e, com
// --gravar, grava na linha do tempo (o mesmo que o cron
// /api/cron/base-unica-bitrix?produto=... faz de hora em hora).
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/sincronizar-bitrix-produtos.ts [cap|auto|re] [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { contarPorMes, gravarBitrixProduto, lerBitrixProduto, type ProdutoBitrix } from "@/lib/baseUnica/bitrixProdutos";

const ALIAS: Record<string, ProdutoBitrix> = { cap: "capitalizacao", auto: "automovel", re: "re" };

async function main() {
  const produtos = process.argv.slice(2).filter((a) => a in ALIAS).map((a) => ALIAS[a]);
  const sb = createServiceClient();
  for (const produto of produtos.length ? produtos : (Object.values(ALIAS) as ProdutoBitrix[])) {
    const dados = await lerBitrixProduto(produto);
    const porMes = contarPorMes(dados.linhas);
    const tabela = produto === "capitalizacao" ? "capitalizacao_snapshots" : produto === "automovel" ? "seguro_auto_snapshots" : "ramos_elementares_snapshots";
    const { data: retratos } = await sb.from(tabela).select("competencia, payload").gte("competencia", "2026-07").order("competencia");
    console.log(`\n== ${produto}: ${dados.linhas.length} cards (${[...new Set(dados.linhas.map((l) => l.produto))].join(", ")})`);
    for (const m of Object.keys(porMes).sort()) {
      const p = porMes[m];
      const r = (retratos ?? []).find((x) => x.competencia === m)?.payload;
      const ref =
        produto === "capitalizacao" ? r && `painel: total ${r.kpis.total}, emitidos ${r.kpis.emitidos}, perdidos ${r.kpis.perdidos}`
        : produto === "automovel" ? r && `painel: total ${r.kpis.total}, convertidos ${r.kpis.convertidos}, perdidos ${r.kpis.perdidos}`
        : r && `painel: novas ${r.visaoGeral.novasEntradas}, efetivados ${r.visaoGeral.novosEfetivados}`;
      console.log(`  ${m} | ${JSON.stringify(p)}${ref ? ` | ${ref}` : ""}`);
    }
    if (process.argv.includes("--gravar")) console.log(await gravarBitrixProduto(sb, produto, dados));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
