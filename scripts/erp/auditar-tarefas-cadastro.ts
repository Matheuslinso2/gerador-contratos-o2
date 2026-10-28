// Auditoria das tarefas "CADASTRO … CORP" desde uma data (padrão 01/09/2026): lê o chat de cada tarefa (SÓ LEITURA no Bitrix),
// extrai os dados de cada proposta, liga ao documento do ERP (Código O2 = nosso_numero) e COMPARA campo a campo
// (vigência, comissão, seguradora). Não grava nada. Gera um CSV fora do projeto (dados pessoais). uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/auditar-tarefas-cadastro.ts [--desde 2026-09-01] [--saida arquivo.csv]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { chamadorBitrix, documentosDoNome, lerChatDaTarefa, lerMensagemCadastro, listarTarefas, type DocDoNome } from "@/lib/erp/tarefaCadastro";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const DESDE = arg("desde") ?? "2026-09-01";
const SAIDA = arg("saida") ?? path.join(os.tmpdir(), "auditoria-tarefas-cadastro.csv");
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
const sb = createServiceClient();
const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\s+/g, " ")}"`;

(async () => {
  const { data: segs } = await sb.from("erp_seguradoras").select("id,nome,abreviacao");
  const nomeSeg = new Map((segs ?? []).map((s) => [s.id, `${s.nome} ${s.abreviacao ?? ""}`.toUpperCase()]));
  const tarefas = (await listarTarefas(bx, "CADASTRO", 2000)).filter((t) => /CORP/i.test(t.title) && String(t.createdDate).slice(0, 10) >= DESDE);
  console.log(`AUDITORIA desde ${DESDE}: ${tarefas.length} tarefas`);
  const cabecalho = ["tarefa", "titulo_tarefa", "mensagem", "nome_proposta", "imobiliaria", "contratacao", "vigencia_msg", "comissao_msg", "seguradora_plano_msg", "assunto_email", "pdfs", "ligacao", "codigo_o2", "doc_situacao", "doc_vigencia", "doc_comissao", "doc_seguradora", "confere_vigencia", "confere_comissao", "confere_seguradora", "observacao"];
  const linhas: string[] = [cabecalho.map(csv).join(";")];
  const res = { mensagens: 0, comDados: 0, semDados: 0, ligadas: 0, soNome: 0, nenhuma: 0, divergeVigencia: 0, divergeComissao: 0, divergeSeguradora: 0, conferemTudo: 0 };
  for (const t of tarefas) {
    let chat: Awaited<ReturnType<typeof lerChatDaTarefa>>;
    try { chat = await lerChatDaTarefa(bx, Number(t.id)); } catch (e) { console.log(`erro tarefa ${t.id}: ${(e as Error).message.slice(0, 80)}`); continue; }
    const cnt ={ mensagens: 0, comDados: 0, ligadas: 0, soNome: 0, nenhuma: 0, conferemTudo: 0 };
    for (const m of chat.mensagens) {
      const texto = String(m.text ?? "");
      if (!texto.trim()) continue;
      res.mensagens++; cnt.mensagens++;
      const p = lerMensagemCadastro(texto, { arquivos: (m.params?.FILE_ID ?? []).length, data: m.date ?? null, id: m.id, tarefa: Number(t.id) });
      if (!p) { res.semDados++; continue; }
      res.comDados++; cnt.comDados++;
      let docs: DocDoNome[] = [];
      for (let tentativa = 0; p.nome; tentativa++) {
        try { docs = await documentosDoNome(sb, p.nome); break; } catch (e) {
          if (tentativa >= 4) throw e;
          await new Promise((x) => setTimeout(x, 2000 * (tentativa + 1))); // queda de conexão com o banco: tenta de novo
        }
      }
      const perto = docs.filter((d) => d.vigencia_inicio && p.vigencia_inicio && dias(d.vigencia_inicio, p.vigencia_inicio) <= 5);
      let ligacao = "nenhuma";
      let doc: DocDoNome | undefined;
      if (perto.length) { ligacao = perto.length > 1 ? "nome+vigencia (mais de um doc)" : "nome+vigencia"; doc = perto.find((d) => !d.numero_apolice) ?? perto[0]; }
      else if (docs.length) ligacao = "so-nome";
      if (doc) { res.ligadas++; cnt.ligadas++; } else if (ligacao === "so-nome") { res.soNome++; cnt.soNome++; } else { res.nenhuma++; cnt.nenhuma++; }
      const segDoc = doc?.seguradora_id ? nomeSeg.get(doc.seguradora_id) ?? "" : "";
      const segMsg = (p.seguradora_plano ?? "").toUpperCase();
      const confVig = doc ? (doc.vigencia_inicio && p.vigencia_inicio ? (dias(doc.vigencia_inicio, p.vigencia_inicio) <= 1 && (!p.vigencia_fim || !doc.vigencia_fim || dias(doc.vigencia_fim, p.vigencia_fim) <= 1) ? "sim" : "não") : "sem dado") : "";
      const confCom = doc ? (doc.comissao_pct != null && p.comissao_pct != null ? (Math.abs(Number(doc.comissao_pct) - p.comissao_pct) < 0.01 ? "sim" : "não") : "sem dado") : "";
      const confSeg = doc ? (segDoc && segMsg ? (segMsg.split(/\s+/).some((w) => w.length > 3 && segDoc.includes(w)) ? "sim" : "não") : "sem dado") : "";
      if (confVig === "não") res.divergeVigencia++;
      if (confCom === "não") res.divergeComissao++;
      if (confSeg === "não") res.divergeSeguradora++;
      if (doc && confVig === "sim" && confCom === "sim" && confSeg === "sim") { res.conferemTudo++; cnt.conferemTudo++; }
      const obs = !p.vigencia_inicio ? "mensagem sem vigência" : p.comissao_pct === null ? "mensagem sem comissão" : "";
      linhas.push(
        [t.id, t.title, m.id, p.nome, p.imobiliaria, p.campos["CONTRATAÇÃO"] ?? p.campos["CONTRATACAO"] ?? "", p.vigencia_inicio ? `${p.vigencia_inicio}→${p.vigencia_fim ?? ""}` : "", p.comissao_pct ?? "", p.seguradora_plano, p.assunto_email, p.arquivos, ligacao, doc?.nosso_numero ?? "", doc?.situacao ?? "", doc ? `${doc.vigencia_inicio ?? ""}→${doc.vigencia_fim ?? ""}` : "", doc?.comissao_pct ?? "", segDoc, confVig, confCom, confSeg, obs]
          .map(csv)
          .join(";")
      );
    }
    console.log(`${t.id} ${t.title.slice(0, 44)}: ${JSON.stringify(cnt)}`);
  }
  fs.writeFileSync(SAIDA, "﻿" + linhas.join("\n"));
  console.log(JSON.stringify(res));
  console.log("arquivo:", SAIDA);
})();
