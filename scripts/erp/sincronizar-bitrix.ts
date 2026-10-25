// ERP O2 — T2: todos os cards do Bitrix (Fiança 1042, Produção Incêndio/RE 1046, Capitalização 1048,
// Automóvel 1050) → documentos do ERP (pré-cadastro com Código O2 interno), com o card inteiro,
// a trilha de etapas e os comentários guardados em erp_origens. Lógica em src/lib/erp/bitrixOrigem.ts.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/sincronizar-bitrix.ts
//        [--gravar] [--spa 1046] [--desde 2026-07-01] [--comentarios 150] [--card 3002,3010] [--escrever-bitrix abertos|todos]
// Sem --gravar só simula. Sem --spa roda os quatro funis.
process.loadEnvFile(".env.local");

import { createServiceClient } from "@/lib/supabase/service";
import { CONFIGS, sincronizarSpa } from "@/lib/erp/bitrixOrigem";

function arg(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] ?? "" : null;
}

async function main() {
  const gravar = process.argv.includes("--gravar");
  const desde = arg("--desde") ?? "2026-07-01";
  const comentarios = Number(arg("--comentarios") ?? (gravar ? 150 : 0));
  const spa = Number(arg("--spa") ?? 0);
  const apenasCards = (arg("--card") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  const sb = createServiceClient();
  for (const cfg of CONFIGS.filter((c) => !spa || c.entityTypeId === spa)) {
    const t0 = Date.now();
    const escrever = arg("--escrever-bitrix");
    const r = await sincronizarSpa(sb, cfg, { desde, gravar, comentarios, apenasCards: apenasCards.length ? apenasCards : undefined, escreverNoBitrix: escrever === "todos" ? "todos" : escrever === null ? false : "abertos" });
    console.log(`${gravar ? "GRAVADO" : "SIMULAÇÃO"} · SPA ${r.spa} ${r.nome} · cards desde ${desde}: ${r.cards} · ${Math.round((Date.now() - t0) / 1000)} s`);
    console.log(`  criados: ${r.criados} | ligados a documento do Corp: ${r.ligados_ao_corp} | atualizados: ${r.atualizados}`);
    console.log(`  sem imobiliária: ${r.sem_imobiliaria} | sem CPF/CNPJ do cliente: ${r.sem_cliente} | comentários: ${r.comentarios_capturados} | renovações ligadas: ${r.renovacoes_ligadas} | erros: ${r.erros.length}`);
    if (r.endossos_ligados || r.endossos_sem_apolice) console.log(`  endossos ligados à apólice: ${r.endossos_ligados} | sem apólice certa: ${r.endossos_sem_apolice} | avisos escritos no Bitrix: ${r.avisos_no_bitrix}`);
    for (const e of r.erros.slice(0, 10)) console.log(`  erro card ${e.card}: ${e.erro}`);
  }
}
main().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
