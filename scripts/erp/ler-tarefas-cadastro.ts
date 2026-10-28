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

/** Documentos do ERP em que o nome da proposta (inteiro ou cada pessoa de "A E B") aparece como cliente ou como parte do item. */
async function documentosDoNome(nomeBruto: string): Promise<{ id: string; vigencia_inicio: string | null; situacao: string; numero_apolice: string | null; via: string }[]> {
  const pessoas = [...new Set([norm(nomeBruto), ...norm(nomeBruto).split(/ E /).map((x) => x.trim())])].filter((x) => x.split(" ").length >= 2);
  const achados = new Map<string, { id: string; vigencia_inicio: string | null; situacao: string; numero_apolice: string | null; via: string }>();
  for (const nome of pessoas) {
    const toks = nome.split(" ");
    const { data: ls } = await sb.from("locatarios").select("id").eq("nome_normalizado", nome).limit(5);
    if (ls?.length) {
      const { data: ds } = await sb.from("erp_documentos").select("id,vigencia_inicio,situacao,numero_apolice").in("locatario_id", ls.map((l) => l.id));
      for (const d of ds ?? []) achados.set(d.id, { ...d, via: "cliente" });
    }
    const { data: ps } = await sb.from("erp_item_partes").select("item_id,nome").ilike("nome", `%${toks[0]}%${toks[toks.length - 1]}%`).limit(40);
    const exatos = (ps ?? []).filter((x) => norm(x.nome ?? "") === nome).map((x) => x.item_id);
    if (exatos.length) {
      const { data: its } = await sb.from("erp_documento_itens").select("documento_id").in("id", exatos);
      const docIds = [...new Set((its ?? []).map((i) => i.documento_id))];
      if (docIds.length) {
        const { data: ds } = await sb.from("erp_documentos").select("id,vigencia_inicio,situacao,numero_apolice").in("id", docIds);
        for (const d of ds ?? []) if (!achados.has(d.id)) achados.set(d.id, { ...d, via: "parte do item" });
      }
    }
  }
  return [...achados.values()];
}

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
  const r = { pendentes: 0, jaEmitidos: 0, semNome: 0, semVigencia: 0, semComissao: 0, semSeguradora: 0, porProposta: 0, porNomeEVigencia: 0, soNome: 0, nenhum: 0 };
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
      const docs = await documentosDoNome(p.nome);
      const perto = docs.filter((d) => d.vigencia_inicio && p.vigencia_inicio && Math.abs(Date.parse(d.vigencia_inicio) - Date.parse(p.vigencia_inicio)) <= 5 * 864e5);
      como = perto.length ? "nome+vigencia" : docs.length ? "so-nome" : "nenhum";
      if (perto.length) { if (perto.some((d) => !d.numero_apolice)) r.pendentes++; else r.jaEmitidos++; }
    }
    if (como === "proposta") r.porProposta++; else if (como === "nome+vigencia") r.porNomeEVigencia++; else if (como === "so-nome") r.soNome++; else r.nenhum++;
    if (amostra.length < 8) amostra.push(`${mascara(p.nome)} | ${p.imobiliaria?.slice(0, 22) ?? "-"} | seg ${p.seg ? p.seg.slice(0, 2) + "****" : "-"} | vig ${p.vigencia_inicio ?? "-"}→${p.vigencia_fim ?? "-"} | ${p.seguradora_plano ?? "-"} | com ${p.comissao_pct ?? "-"}% | repasses ${p.repasses.length} | pdfs ${p.arquivos} | ligação: ${como}`);
  }
  console.log(JSON.stringify(r));
  console.log(amostra.join("\n"));
})();
