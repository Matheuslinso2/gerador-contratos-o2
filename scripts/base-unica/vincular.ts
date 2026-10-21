// Base Única — conferência manual dos vínculos automáticos. A lógica está em
// src/lib/baseUnica/vinculosAutomaticos.ts, a mesma que roda de hora em hora no
// cron /api/cron/base-unica-vinculos. Sem --gravar só simula.
// uso: npx tsx scripts/base-unica/vincular.ts [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { vincularAutomaticamente } from "@/lib/baseUnica/vinculosAutomaticos";

async function main() {
  const r = await vincularAutomaticamente(createServiceClient(), { gravar: process.argv.includes("--gravar") });
  console.log(`avaliados: ${r.avaliados} | mudanças: ${r.mudancas}`, r.porTipo);
  for (const c of r.confirmadosPorNome.slice(0, 40)) console.log(`  ${c.fonte} "${c.nome}" → ${c.ficha} [${c.como}]`);
  console.log(`para revisão: ${r.revisarGruposDiferentes} nome igual a fichas de grupos diferentes | ${r.revisarParecido} só parecido`);
  console.log(r.gravado ? "\ngravado." : "\n(simulação — nada gravado; use --gravar)");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
