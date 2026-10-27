// Liga e-mails das caixas O2 às imobiliárias/apólices (só leitura), em lotes retomáveis. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/indexar-emails.ts
//     [--escopo vigentes|todas] [--nome Ramiro] [--dias 900] [--limite 1000] [--lote 25] [--paralelo 4]
//     [--caixas a@o2seguros.com.br,b@...]
// Rodar de novo continua de onde parou (erp_emails_progresso); mudar --dias ou --lote refaz os lotes afetados.
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { indexarEmailsDeImobiliarias } from "@/lib/erp/emails";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const inicio = Date.now();
indexarEmailsDeImobiliarias(createServiceClient(), {
  nome: arg("nome"),
  escopo: arg("escopo") === "todas" ? "todas" : "vigentes",
  dias: Number(arg("dias") ?? 900),
  limitePorBusca: Number(arg("limite") ?? 1000),
  tamanhoLote: Number(arg("lote") ?? 25),
  paralelo: Number(arg("paralelo") ?? 4),
  caixas: arg("caixas")?.split(","),
  log: (m) => console.log(`[${Math.round((Date.now() - inicio) / 1000)}s] ${m}`),
})
  .then((r) => console.log(JSON.stringify({ ...r, segundos: Math.round((Date.now() - inicio) / 1000) })))
  .catch((e) => { console.error(e.message); process.exit(1); });
