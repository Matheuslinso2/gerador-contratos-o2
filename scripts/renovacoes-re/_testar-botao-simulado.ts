process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { criarCardsRenovacaoRE } from "@/lib/erp/renovacaoCriarCards";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data } = await sb.rpc("erp_renovacao_documentos", { p_de: "2026-12-01", p_ate: "2026-12-31" }).range(0, 999);
  const sem = (data as any[]).filter((d) => !d.status_renovacao);
  const pega = (ramo: string, n: number) => sem.filter((d) => d.ramo === ramo).slice(0, n);
  const docs = [...pega("RESIDENCIAL", 2), ...pega("EMPRESARIAL", 1), ...pega("CONDOMINIO", 1), ...pega("VIDA INDIVIDUAL", 1)];
  const abrev: Record<string, string> = { RESIDENCIAL: "RESI", EMPRESARIAL: "EMPR", CONDOMINIO: "COND", "VIDA INDIVIDUAL": "VIND" };
  const pedidos = docs.map((d) => ({ titulo: `RENOVAÇÃO - ${abrev[d.ramo]} - ${d.cliente} - 12.2026`, documentoIds: [d.documento_id] }));
  const r = await criarCardsRenovacaoRE(pedidos, { bloco: "re_demais", de: "2026-12-01", ate: "2026-12-31", usuarioEmail: "teste-simulado@o2seguros.com.br", simular: true });
  for (const x of r) console.log(x.resultado, "|", x.titulo, "|", x.detalhe);
}
main().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
