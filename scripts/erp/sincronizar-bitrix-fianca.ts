// ERP O2 — T2: cards de Seguro Fiança do Bitrix (SPA 1042) → documentos do ERP (pré-cadastro
// com Código O2, interno), com o card inteiro e a trilha guardados em erp_origens.
// Lógica em src/lib/erp/bitrixOrigem.ts.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/sincronizar-bitrix-fianca.ts
//        [--gravar] [--desde 2026-07-01] [--comentarios 150] [--card 3002,3010]
// Sem --gravar só simula e mostra o que faria.
process.loadEnvFile(".env.local");

import { createServiceClient } from "@/lib/supabase/service";
import { sincronizarFiancaBitrix } from "@/lib/erp/bitrixOrigem";

function arg(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] ?? "" : null;
}

async function main() {
  const gravar = process.argv.includes("--gravar");
  const desde = arg("--desde") ?? "2026-07-01";
  const comentarios = Number(arg("--comentarios") ?? (gravar ? 150 : 0));
  const apenasCards = (arg("--card") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  const sb = createServiceClient();
  const t0 = Date.now();
  const r = await sincronizarFiancaBitrix(sb, { desde, gravar, comentarios, apenasCards: apenasCards.length ? apenasCards : undefined });
  console.log(`${gravar ? "GRAVADO" : "SIMULAÇÃO"} · cards desde ${desde}: ${r.cards}`);
  console.log(`  criados no ERP: ${r.criados} | ligados a documento do Corp (Nosso Nº Corp no card): ${r.ligados_ao_corp} | atualizados: ${r.atualizados}`);
  console.log(`  sem imobiliária ligada (Empresa do card sem vínculo): ${r.sem_imobiliaria} | sem CPF do locatário: ${r.sem_cpf}`);
  console.log(`  comentários capturados nesta rodada: ${r.comentarios_capturados} | erros: ${r.erros.length} | ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const e of r.erros.slice(0, 15)) console.log(`  erro card ${e.card}: ${e.erro}`);
}
main().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
