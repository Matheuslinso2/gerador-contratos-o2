// Teste SIMULADO do botão Autorizar criação (nada é criado no Bitrix nem gravado no banco).
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { criarCardsRenovacao, type BlocoCriacao } from "@/lib/erp/renovacaoCriarCards";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
async function main() {
  const todos: any[] = [];
  for (let de = 0; de < 3000; de += 1000) {
    const { data } = await sb.rpc("erp_renovacao_documentos", { p_de: "2026-11-01", p_ate: "2026-12-31" }).range(de, de + 999);
    todos.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const sem = todos.filter((d) => !d.status_renovacao);
  const casos: [BlocoCriacao, (d: any) => boolean, (d: any) => string][] = [
    ["re_demais", (d) => d.ramo === "RESIDENCIAL", (d) => `RENOVAÇÃO - RESI - ${d.cliente} - 12.2026`],
    ["fianca", (d) => d.produto === "fianca", (d) => `${d.cliente}${d.imobiliaria ? " - " + d.imobiliaria : ""}`],
    ["cap", (d) => d.produto === "capitalizacao", (d) => `VENCE ${br(d.vigencia_fim)} | ${d.cliente} | CORP ${d.nosso_numero}`],
    ["auto", (d) => d.produto === "automovel", (d) => `RENOVAÇÃO - ${br(d.vigencia_fim)} - ${d.cliente}`],
  ];
  for (const [bloco, filtro, titulo] of casos) {
    const docs = sem.filter(filtro).slice(0, 2);
    if (!docs.length) { console.log(bloco, "→ nenhum documento sem card para testar"); continue; }
    const r = await criarCardsRenovacao(docs.map((d) => ({ titulo: titulo(d), documentoIds: [d.documento_id] })), { bloco, de: "2026-11-01", ate: "2026-12-31", usuarioEmail: "teste-simulado@o2seguros.com.br", simular: true });
    for (const x of r) console.log(bloco, "|", x.resultado, "|", x.titulo, "|", x.detalhe);
  }
}
main().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
