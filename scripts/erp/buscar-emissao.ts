// Procura nas caixas O2 (só leitura) e-mails que provem a emissão de propostas pendentes. NÃO grava em erp_documentos. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/buscar-emissao.ts [--meses 30] [--limite 3000] [--paralelo 4] [--caixas a@o2seguros.com.br,...]
// Retomável (erp_emails_progresso, lotes "emissao:AAAA-MM").
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { buscarProvasDeEmissao } from "@/lib/erp/emailsEmissao";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const inicio = Date.now();
buscarProvasDeEmissao(createServiceClient(), {
  meses: Number(arg("meses") ?? 30),
  limitePorBusca: Number(arg("limite") ?? 3000),
  paralelo: Number(arg("paralelo") ?? 4),
  caixas: arg("caixas")?.split(","),
  log: (m) => console.log(`[${Math.round((Date.now() - inicio) / 1000)}s] ${m}`),
})
  .then((r) => console.log(JSON.stringify({ ...r, segundos: Math.round((Date.now() - inicio) / 1000) })))
  .catch((e) => { console.error(e.message); process.exit(1); });
