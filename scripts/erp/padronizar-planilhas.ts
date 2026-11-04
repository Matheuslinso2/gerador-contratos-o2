process.loadEnvFile(".env.local");
// Padroniza TODAS as linhas de todas as abas das planilhas (erp_planilha_linhas, lidas 1 vez) em erp_planilha_registro,
// em lotes, até não sobrar linha nova/alterada. Os vínculos usam só a tabela padronizada.
// Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/padronizar-planilhas.ts
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();

async function main() {
  for (;;) {
    const { data, error } = await sb.rpc("erp_planilha_registro_atualizar", { p_lote: 3000 });
    if (error) { console.error(error.message); process.exit(1); }
    const r = data as { registros: number; total: number };
    console.log(new Date().toISOString(), r);
    if (r.registros < 3000) break;
  }
}
main();
