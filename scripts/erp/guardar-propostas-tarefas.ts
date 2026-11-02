// Guarda a PROPOSTA (PDF anexado nas tarefas "CADASTRO … CORP" do Bitrix, SÓ LEITURA no Bitrix) como anexo do documento do ERP
// (bucket anexos-documentos + erp_documento_anexos, tipo 'proposta', origem 'bitrix'). A proposta é documento de confiança, recém efetivada
// pela equipe: é a prova de que o negócio foi efetivado e entra em Emissão. Liga ao documento pelo NOME da proposta + vigência (±5 dias)
// quando há um único documento; o resto fica numa lista de pendentes (nada é inventado, nada é criado aqui).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/guardar-propostas-tarefas.ts --titulo "CADASTRO FIANÇA CORP" [--tarefas 3] [--gravar]
// Sem --gravar é ensaio (lê tudo, baixa os PDFs para contar, não grava nada).
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { chamadorBitrix, documentosDoNome, lerChatDaTarefa, lerMensagemCadastro, listarTarefas } from "@/lib/erp/tarefaCadastro";
import { guardarAnexo } from "@/lib/erp/anexosEmail";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
const sb = createServiceClient();
const mascara = (n: string | null) => (n ? n.split(" ")[0] + " …" : "-");

(async () => {
  const titulo = arg("titulo") ?? "CADASTRO FIANÇA CORP";
  const tarefas = (await listarTarefas(bx, titulo, 2000)).slice(0, Number(arg("tarefas") ?? 3));
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${tarefas.length} tarefas de "${titulo}"`);
  const r = { mensagens: 0, propostas: 0, semPdf: 0, semVigencia: 0, semDocumento: 0, variosDocumentos: 0, ligadas: 0, pdfsGuardados: 0, erros: 0 };
  const pendentes: string[] = [];
  for (const t of tarefas) {
    let chat: Awaited<ReturnType<typeof lerChatDaTarefa>>;
    try { chat = await lerChatDaTarefa(bx, Number(t.id)); } catch (e) { console.log(`erro tarefa ${t.id}: ${(e as Error).message.slice(0, 80)}`); r.erros++; continue; }
    r.mensagens += chat.mensagens.length;
    for (const m of chat.mensagens) {
      const p = lerMensagemCadastro(String(m.text ?? ""), { arquivos: (m.params?.FILE_ID ?? []).length, data: m.date ?? null, id: m.id, tarefa: Number(t.id) });
      if (!p) continue;
      r.propostas++;
      const pdfs = ((m.params?.FILE_ID ?? []) as number[]).map((id) => chat.arquivos.get(Number(id))).filter((f) => f && /\.pdf$/i.test(String(f.name ?? "")));
      if (!pdfs.length) { r.semPdf++; continue; }
      if (!p.nome) { r.semDocumento++; continue; }
      if (!p.vigencia_inicio) { r.semVigencia++; pendentes.push(`${mascara(p.nome)} | tarefa ${t.id} | sem vigência no texto (ler do PDF)`); continue; }
      const docs = (await documentosDoNome(sb, p.nome)).filter((d) => d.vigencia_inicio && Math.abs(Date.parse(d.vigencia_inicio) - Date.parse(p.vigencia_inicio!)) <= 5 * 864e5);
      if (!docs.length) { r.semDocumento++; pendentes.push(`${mascara(p.nome)} | tarefa ${t.id} | ${p.vigencia_inicio} | sem documento no ERP`); continue; }
      if (docs.length > 1) { r.variosDocumentos++; pendentes.push(`${mascara(p.nome)} | tarefa ${t.id} | ${docs.length} documentos possíveis`); continue; }
      r.ligadas++;
      if (!GRAVAR) continue;
      for (const f of pdfs) {
        try {
          // o link do chat (urlDownload) exige login; a API de disco devolve um link de download com token do webhook
          const g = await bx("disk.file.get", { id: f.id });
          const url = String(g.result?.DOWNLOAD_URL ?? "");
          if (!url) continue;
          const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
          if (buf.length < 500 || buf.subarray(0, 4).toString() !== "%PDF") continue;
          await guardarAnexo(sb, {
            doc: { id: docs[0].id }, pdf: buf, nome: String(f.name), messageId: `tarefa:${t.id}:msg:${p.mensagem_id}`, tipo: "proposta", origem: "bitrix",
            av: { situacao: "provavel", cpf: false, num: false, vig: true },
            extra: { fonte: "tarefa CADASTRO (Bitrix)", tarefa: Number(t.id), mensagem: p.mensagem_id, ligado_por: "nome+vigência", imobiliaria_texto: p.imobiliaria, vigencia_texto: p.vigencia_inicio },
          });
          r.pdfsGuardados++;
        } catch (e) { r.erros++; console.log(`erro pdf ${f.id}: ${(e as Error).message.slice(0, 90)}`); }
      }
    }
  }
  console.log(JSON.stringify(r));
  console.log(pendentes.slice(0, 25).join("\n"));
})();
