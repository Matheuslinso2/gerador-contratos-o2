// Carga das linhas das faturas Tokio/Porto no ERP (fase B). uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-itens-faturas.ts [AAAA-MM]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { carregarItensFaturas } from "@/lib/erp/faturasItens";
carregarItensFaturas(createServiceClient(), { desde: process.argv[2] ?? "2026-09" })
  .then((r) => console.log(JSON.stringify(r)))
  .catch((e) => { console.error(e.message); process.exit(1); });
