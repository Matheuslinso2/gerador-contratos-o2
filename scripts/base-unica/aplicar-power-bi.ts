// Base Única × Power BI — conferência manual. A lógica está em
// src/lib/baseUnica/aplicarPowerBi.ts (a mesma que roda no fim do cron
// /api/cron/corp-sharepoint). Sem --gravar só simula e lista; conflitos com
// decisões já confirmadas que o Matheus ainda não aprovou aparecem em
// "pendentes" e nunca são aplicados.
// uso: npx tsx scripts/base-unica/aplicar-power-bi.ts [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { aplicarPowerBi } from "@/lib/baseUnica/aplicarPowerBi";

async function main() {
  const r = await aplicarPowerBi(createServiceClient(), { gravar: process.argv.includes("--gravar") });
  console.log(`produtores no PBI: ${r.produtores} | ligados a registro do Corp: ${r.ligadosAoCorp}`);
  console.log(`ligar à ficha de mesmo nome: ${r.ligarPorNomeIgual} | criar ficha: ${r.fichasCriar.length} | sem registro no Corp: ${r.semRegistroNoCorp} | fora da base: ${r.foraDaBase}`);
  for (const f of r.fichasCriar) console.log(`  nova: ${f.nome}${f.possivelDuplicataDe.length ? ` (parecida com ${f.possivelDuplicataDe.join(", ")})` : ""}`);
  console.log(`venda direta O2: ${r.vendaDireta.join(" | ")}`);
  for (const g of r.grupos) console.log(` ${g.centralizador} → ${g.novo ? "grupo NOVO" : `"${g.grupo}"`} | ${g.fichas} fichas | mudam: ${g.mudam.join("; ") || "nada"}`);
  console.log(`saem do grupo: ${r.sairDoGrupo.join("; ") || "nenhuma"}`);
  console.log(`PENDENTES (não aplicados): ${r.pendentes.length ? "\n  " + r.pendentes.map((p) => `[${p.tipo}] ${p.descricao}`).join("\n  ") : "nenhum"}`);
  console.log(r.gravado ? `\ngravado: ${r.alteracoes} alterações no histórico.` : "\n(simulação — nada gravado; use --gravar)");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
