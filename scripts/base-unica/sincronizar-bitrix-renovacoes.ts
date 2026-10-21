// Base Única — lê os funis de RENOVAÇÃO do Bitrix (Fiança cat. 32, RE cat. 34)
// e confere, mês a mês, com o retrato do painel de cada produto. Com --gravar,
// grava na linha do tempo (producao_unificada, tipo='renovacao', fonte='bitrix')
// — o mesmo que o cron /api/cron/base-unica-bitrix?produto=fianca-renovacao|re-renovacao
// faz de hora em hora. Lógica em src/lib/baseUnica/bitrixRenovacoes.ts.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/sincronizar-bitrix-renovacoes.ts [fianca|re] [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { contarRenovacoesPorMes, gravarRenovacoesBitrix, lerRenovacoesBitrix, type ProdutoRenovacao } from "@/lib/baseUnica/bitrixRenovacoes";

const args = process.argv.slice(2);
const gravar = args.includes("--gravar");
const produtos = (["fianca", "re"] as ProdutoRenovacao[]).filter((p) => args.includes(p) || !args.some((a) => a === "fianca" || a === "re"));

async function main() {
  const sb = createServiceClient();
  for (const produto of produtos) {
    const dados = await lerRenovacoesBitrix(produto);
    const porMes = contarRenovacoesPorMes(dados.linhas);
    const semEmpresa = dados.linhas.filter((l) => !l.imobiliaria_texto).length;
    console.log(`\n==== ${produto.toUpperCase()} (Bitrix): ${dados.linhas.length} cards | sem empresa: ${semEmpresa}`);
    if (produto === "fianca") {
      const { data: ret } = await sb.from("seguro_fianca_renovacao_snapshots").select("competencia, payload").order("competencia");
      console.log("mês | recebidas (base/painel) | renovadas | não renovadas");
      for (const m of Object.keys(porMes).sort()) {
        const k = (ret ?? []).find((r) => r.competencia === m)?.payload?.kpis as { novos?: number; renovados?: number; perdidos?: number } | undefined;
        const p = porMes[m];
        console.log(`${m} | ${p.recebidas_fianca ?? 0}/${k?.novos ?? "—"} | ${p.renovadas_fianca ?? 0}/${k?.renovados ?? "—"} | ${p.nao_renovadas_fianca ?? 0}/${k?.perdidos ?? "—"}`);
      }
    } else {
      const { data: ret } = await sb.from("ramos_elementares_snapshots").select("competencia, payload").order("competencia");
      console.log("mês | recebidas RE (+auto) | efetivadas | não efetivadas | painel RE (renovações da competência / efetivadas — a partir de out só Bitrix; set = planilha + Bitrix)");
      for (const m of Object.keys(porMes).sort()) {
        const v = (ret ?? []).find((r) => r.competencia === m)?.payload?.visaoGeral as { renovacoesEntradas?: number; renovacoesCompetencia?: number; renovacoesEfetivadas?: number } | undefined;
        const p = porMes[m];
        console.log(
          `${m} | ${p.recebidas_re ?? 0} (+${p.recebidas_automovel ?? 0}) | ${p.renovadas_re ?? 0} (+${p.renovadas_automovel ?? 0}) | ${p.nao_renovadas_re ?? 0} (+${p.nao_renovadas_automovel ?? 0}) | ${v ? `${v.renovacoesEntradas ?? v.renovacoesCompetencia ?? "—"} / ${v.renovacoesEfetivadas ?? "—"}` : "—"}`
        );
      }
    }
    if (gravar) console.log(await gravarRenovacoesBitrix(sb, produto, dados));
  }
  if (!gravar) console.log("\n(simulação — nada gravado; use --gravar)");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
