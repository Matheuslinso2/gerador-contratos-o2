// Lê (SÓ LEITURA) as tarefas de premiação do Bitrix: título, status, prazo, descrição e lista de verificação (checklist).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ler-tarefas-premiacao.ts [--ids 15580,7720,...]
process.loadEnvFile(".env.local");
import { chamadorBitrix } from "@/lib/erp/tarefaCadastro";
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
const ids = (arg("ids") ?? "15580,7720,13778,12846,11824,8364,1415").split(",").map(Number);
(async () => {
  for (const id of ids) {
    const g = await bx("tasks.task.get", { taskId: id, select: ["ID", "TITLE", "STATUS", "DEADLINE", "CREATED_DATE", "CLOSED_DATE", "DESCRIPTION", "RESPONSIBLE_ID", "GROUP_ID", "CHAT_ID", "UF_CRM_TASK"] });
    const t = g.result?.task;
    if (!t) { console.log(`#${id}: ${g.error ?? "sem retorno"} ${g.error_description ?? ""}`); continue; }
    console.log(`\n=== #${id} ${t.title} | status ${t.status} | prazo ${t.deadline ?? "-"} | criada ${t.createdDate?.slice(0, 10)} | fechada ${t.closedDate?.slice(0, 10) ?? "-"} | chat ${t.chatId ?? "-"}`);
    if (t.description) console.log("DESCRIÇÃO: " + String(t.description).replace(/\s+\n/g, "\n").slice(0, 1800));
    const c = await bx("task.checklistitem.getlist", { TASKID: id });
    const itens: any[] = Array.isArray(c.result) ? c.result : [];
    console.log(`CHECKLIST (${itens.length}):`);
    for (const i of itens) console.log(`  [${i.IS_COMPLETE === "Y" ? "x" : " "}] ${i.TITLE}`);
    if (c.error) console.log(`  (checklist: ${c.error} ${c.error_description ?? ""})`);
  }
})();
