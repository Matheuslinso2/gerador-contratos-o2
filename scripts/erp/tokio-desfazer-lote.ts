// Desfaz um lote gravado por tokio-gravar-lote.ts (identificador em erp_documentos.origem_ref = 'lote:<LOTE>:<apólice>'):
// apaga parcelas, itens, anexos (a linha; o arquivo no bucket permanece, é por sha256 e pode estar em uso) e os documentos do lote; os clientes criados pelo
// lote (locatarios.primeira_fonte = 'lote:<LOTE>') só são apagados se não tiverem nenhum documento. Ensaio por padrão: [--apagar]
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/tokio-desfazer-lote.ts TOKIO-PORTAL-20261030 [--apagar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
const sb = createServiceClient(); const LOTE = process.argv[2]; const APAGAR = process.argv.includes("--apagar");
if (!LOTE) throw new Error("informe o identificador do lote");
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
(async () => {
  const { data: docs } = await sb.from("erp_documentos").select("id,numero_apolice").like("origem_ref", `lote:${LOTE}:%`); const ids = (docs ?? []).map((d) => d.id);
  const { data: clis } = await sb.from("locatarios").select("id").eq("primeira_fonte", `lote:${LOTE}`);
  console.log(`${APAGAR ? "APAGANDO" : "ENSAIO"}: ${ids.length} documentos, ${(clis ?? []).length} clientes criados pelo lote`);
  if (!APAGAR) return;
  for (const g of em(ids)) { for (const t of ["erp_parcelas", "erp_documento_anexos", "erp_documento_itens"]) { const { error } = await sb.from(t).delete().in("documento_id", g); if (error) throw new Error(`${t}: ${error.message}`); } const { error } = await sb.from("erp_documentos").delete().in("id", g); if (error) throw new Error("erp_documentos: " + error.message); }
  let removidos = 0; for (const c of clis ?? []) { const { count } = await sb.from("erp_documentos").select("id", { count: "exact", head: true }).eq("locatario_id", c.id); if (!count) { const { error } = await sb.from("locatarios").delete().eq("id", c.id); if (!error) removidos++; } }
  console.log(`apagados ${ids.length} documentos e ${removidos} clientes sem documento`);
})();
