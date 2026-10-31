// Inventário (SÓ LEITURA) das tarefas "CADASTRO ... CORP" do Bitrix: quantidade por tipo e por ano/mês, mais o chat da premiação Porto Elite.
process.loadEnvFile(".env.local");
import { chamadorBitrix, listarTarefas, lerChatDaTarefa } from "@/lib/erp/tarefaCadastro";
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
(async () => {
  const ts = await listarTarefas(bx, "CADASTRO", 3000);
  const tipo = (t: string) => t.toUpperCase().replace(/\b(JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\b/g, "").replace(/[\d/\-–.]+/g, " ").replace(/\s+/g, " ").trim();
  const por = new Map<string, number>(); const anos = new Map<string, number>();
  for (const t of ts) { por.set(tipo(t.title), (por.get(tipo(t.title)) ?? 0) + 1); const a = t.createdDate.slice(0, 7); anos.set(a, (anos.get(a) ?? 0) + 1); }
  console.log(`tarefas com CADASTRO no título: ${ts.length}`);
  console.log([...por].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${v}\t${k}`).join("\n"));
  console.log("por mês de criação:", [...anos].sort().map(([k, v]) => `${k}:${v}`).join(" "));
  const c = await lerChatDaTarefa(bx, 15580);
  console.log(`\nchat PORTO ELITE: ${c.mensagens.length} mensagens`);
  for (const m of c.mensagens.slice(0, 25).reverse()) console.log(`${String(m.date).slice(0, 10)} | ${String(m.text ?? "").replace(/\s+/g, " ").slice(0, 220)}`);
})();
