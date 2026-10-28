// Grava setembro/26 como mês fechado do Painel Comercial v5 (retrato fixo).
// Fonte: kpi.json do pacote da Vanessa (28/10/2026), cujos números de setembro
// vêm do export de 15/10 (preenchimento antigo do CRM). Não são simulados.
//   npx tsx scripts/painel/seed-setembro.ts <caminho do kpi.json>
process.loadEnvFile(".env.local");
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
const arquivo = process.argv[2];
if (!arquivo) throw new Error("Informe o caminho do kpi.json do pacote.");
const kpi = (JSON.parse(fs.readFileSync(arquivo, "utf8")) as { mes: string }[]).filter((r) => r.mes === "2026-09");
if (!kpi.length) throw new Error("Nenhuma linha de 2026-09 no arquivo.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { error } = await db.from("painel_comercial_meses_fechados").upsert({ mes: "2026-09", kpi, origem: "Export de 15/10/2026 (pacote_painel_v5, 28/10/2026)", congelado_em: new Date().toISOString() });
if (error) throw error;
console.log("setembro gravado:", kpi.length, "linhas");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
