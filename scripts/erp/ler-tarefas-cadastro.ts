// Lê as tarefas "CADASTRO … CORP" do Bitrix (webhook BITRIX_WEBHOOK_URL_TAREFAS: task + disk + im, SÓ LEITURA), extrai os dados
// de cada proposta do chat e tenta ligar ao documento do ERP. Ensaio: não grava nada no Bitrix nem no banco. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ler-tarefas-cadastro.ts [--titulo "CADASTRO FIANÇA CORP"] [--tarefas 3] [--ids 17066,16884]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { chamadorBitrix, lerChatDaTarefa, lerMensagemCadastro, listarTarefas, type PropostaCadastro } from "@/lib/erp/tarefaCadastro";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
const sb = createServiceClient();
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();
const mascara = (n: string | null) => (n ? n.split(" ")[0] + " …" : "-");

(async () => {
  const todas = await listarTarefas(bx, arg("titulo") ?? "CADASTRO FIANÇA CORP", 200);
  const ids = arg("ids")?.split(",").map(Number);
  const tarefas = ids ? todas.filter((t) => ids.includes(Number(t.id))) : todas.slice(0, Number(arg("tarefas") ?? 3));
  console.log(`ENSAIO: ${tarefas.length} tarefas: ${tarefas.map((t) => `${t.id} ${t.title}`).join(" | ")}`);
  const propostas: PropostaCadastro[] = [];
  let mensagens = 0, arquivos = 0;
  for (const t of tarefas) {
    const chat = await lerChatDaTarefa(bx, Number(t.id));
    mensagens += chat.mensagens.length;
    arquivos += chat.arquivos.size;
    for (const m of chat.mensagens) {
      const p = lerMensagemCadastro(String(m.text ?? ""), { arquivos: (m.params?.FILE_ID ?? []).length, data: m.date ?? null, id: m.id, tarefa: Number(t.id) });
      if (p) propostas.push(p);
    }
  }
  console.log(`mensagens ${mensagens} | arquivos ${arquivos} | propostas lidas ${propostas.length}`);
  const r = { semNome: 0, semVigencia: 0, semComissao: 0, semSeguradora: 0, porProposta: 0, porNomeEVigencia: 0, soNome: 0, nenhum: 0 };
  const amostra: string[] = [];
  for (const p of propostas) {
    if (!p.nome) r.semNome++;
    if (!p.vigencia_inicio) r.semVigencia++;
    if (p.comissao_pct === null) r.semComissao++;
    if (!p.seguradora_plano) r.semSeguradora++;
    let como = "nenhum";
    if (p.seg) {
      const { data } = await sb.from("erp_documentos").select("id").eq("numero_proposta", p.seg).limit(2);
      if (data?.length) como = "proposta";
    }
    if (como === "nenhum" && p.nome) {
      const { data: ls } = await sb.from("locatarios").select("id").eq("nome_normalizado", norm(p.nome)).limit(5);
      const ids2 = (ls ?? []).map((l) => l.id);
      if (ids2.length) {
        const { data: docs } = await sb.from("erp_documentos").select("id,vigencia_inicio,situacao,numero_apolice").in("locatario_id", ids2);
        const perto = (docs ?? []).filter((d) => d.vigencia_inicio && p.vigencia_inicio && Math.abs(Date.parse(d.vigencia_inicio) - Date.parse(p.vigencia_inicio)) <= 5 * 864e5);
        como = perto.length ? "nome+vigencia" : docs?.length ? "so-nome" : "nenhum";
      }
    }
    if (como === "proposta") r.porProposta++; else if (como === "nome+vigencia") r.porNomeEVigencia++; else if (como === "so-nome") r.soNome++; else r.nenhum++;
    if (amostra.length < 8) amostra.push(`${mascara(p.nome)} | ${p.imobiliaria?.slice(0, 22) ?? "-"} | seg ${p.seg ? p.seg.slice(0, 2) + "****" : "-"} | vig ${p.vigencia_inicio ?? "-"}→${p.vigencia_fim ?? "-"} | ${p.seguradora_plano ?? "-"} | com ${p.comissao_pct ?? "-"}% | repasses ${p.repasses.length} | pdfs ${p.arquivos} | ligação: ${como}`);
  }
  console.log(JSON.stringify(r));
  console.log(amostra.join("\n"));
})();
