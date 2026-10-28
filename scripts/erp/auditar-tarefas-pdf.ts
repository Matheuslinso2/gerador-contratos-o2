// Auditoria v2 das tarefas "CADASTRO … CORP" LENDO OS PDFs (proposta/apólice/endosso/certificado), desde uma data (padrão 01/09/2026).
// SÓ LEITURA no Bitrix e no banco; nada é guardado nem gravado (PDFs só em memória). Por MENSAGEM:
//   1. cada PDF principal (proposta, apólice, cotação, certificado, endosso) liga ao documento por CPF/CNPJ + vigência do PDF;
//      endosso sem vigência liga pela APÓLICE CITADA no PDF (numero_apolice do documento-mãe);
//   2. os PDFs auxiliares da mesma mensagem (contrato de locação, boleto, procuração…) ligam ao documento do PDF principal.
// Compara vigência, prêmio em 4 campos (líquido, IOF, adicional de fracionamento, total — regra do Matheus: total = líquido + IOF
// + adicional), parcelas, comissão e seguradora. Gera CSV fora do projeto (dados pessoais) e o quadro de prêmio por seguradora. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/auditar-tarefas-pdf.ts [--desde 2026-09-01] [--max-arquivos 8] [--saida arquivo.csv]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
import { chamadorBitrix, COLS_DOC, documentosDoNome, lerChatDaTarefa, lerMensagemCadastro, listarTarefas, type DocDoNome } from "@/lib/erp/tarefaCadastro";
import { extrairDadosPdf, type DadosPdf } from "./propostaPdf";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const DESDE = arg("desde") ?? "2026-09-01";
const MAX_ARQ = Number(arg("max-arquivos") ?? 8);
const SAIDA = arg("saida") ?? path.join(os.tmpdir(), "auditoria-tarefas-pdf.csv");
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
const sb = createServiceClient();
const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\s+/g, " ")}"`;
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function comRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let t = 0; ; t++) { try { return await fn(); } catch (e) { if (t >= 4) throw e; await pausa(2000 * (t + 1)); } }
}
const PRINCIPAIS = new Set(["proposta", "apolice", "cotacao", "certificado", "endosso"]);
const igual = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? "sem dado" : Math.abs(Number(a) - Number(b)) < 0.06 ? "sim" : "não");

async function docsPorIds(ids: string[], via: string): Promise<DocDoNome[]> {
  if (!ids.length) return [];
  const { data } = await sb.from("erp_documentos").select(COLS_DOC).in("id", ids);
  return (data ?? []).map((d) => ({ ...(d as Omit<DocDoNome, "via">), via }));
}
/** Documentos em que o CPF/CNPJ é cliente ou parte (garantido/segurado) do item. */
async function documentosDoCpf(cpf: string): Promise<DocDoNome[]> {
  const { data: ls } = await sb.from("locatarios").select("id").eq("cpf", cpf).limit(5);
  if (!ls?.length) return [];
  const ids = ls.map((l) => l.id);
  const achados = new Map<string, DocDoNome>();
  const { data: d1 } = await sb.from("erp_documentos").select(COLS_DOC).in("locatario_id", ids);
  for (const d of d1 ?? []) achados.set(d.id, { ...(d as Omit<DocDoNome, "via">), via: "cpf cliente" });
  const { data: ps } = await sb.from("erp_item_partes").select("item_id").in("locatario_id", ids).limit(200);
  const itens = [...new Set((ps ?? []).map((p) => p.item_id))];
  if (itens.length) {
    const { data: its } = await sb.from("erp_documento_itens").select("documento_id").in("id", itens);
    for (const d of await docsPorIds([...new Set((its ?? []).map((i) => i.documento_id))].filter((i) => !achados.has(i)), "cpf parte do item")) achados.set(d.id, d);
  }
  return [...achados.values()];
}
/** Documento-mãe pelo nº da apólice citado no PDF (o ERP pode guardar só o final do número). */
async function documentosDaApolice(citadas: string[]): Promise<DocDoNome[]> {
  const variantes = new Set<string>();
  for (const d of citadas.slice(0, 4)) { variantes.add(d); for (const k of [6, 7, 8, 9, 10]) if (d.length > k) variantes.add(d.slice(-k)); }
  if (!variantes.size) return [];
  const { data } = await sb.from("erp_documentos").select(COLS_DOC).in("numero_apolice", [...variantes]).limit(40);
  return (data ?? [])
    .filter((d) => { const n = String(d.numero_apolice ?? "").replace(/\D/g, ""); return n.length >= 6 && citadas.some((c) => c.endsWith(n) || n.endsWith(c)); })
    .map((d) => ({ ...(d as Omit<DocDoNome, "via">), via: "apólice citada" }));
}
async function baixarPdf(fileId: number): Promise<Buffer | null> {
  const g = await bx("disk.file.get", { id: fileId });
  const url = g.result?.DOWNLOAD_URL;
  if (!url) return null;
  const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
  return buf.subarray(0, 4).toString() === "%PDF" ? buf : null;
}

type Item = { arquivo: string; dados: DadosPdf | null; obs: string; doc?: DocDoNome; ligacao: string };

(async () => {
  const { data: segs } = await sb.from("erp_seguradoras").select("id,nome,abreviacao");
  const nomeSeg = new Map((segs ?? []).map((s) => [s.id, `${s.nome}`.toUpperCase()]));
  const tarefas = (await listarTarefas(bx, "CADASTRO", 2000)).filter((t) => /CORP/i.test(t.title) && String(t.createdDate).slice(0, 10) >= DESDE);
  console.log(`AUDITORIA v2 desde ${DESDE}: ${tarefas.length} tarefas`);
  const cab = ["tarefa", "titulo_tarefa", "mensagem", "nome_msg", "arquivo", "papel", "tipo_pdf", "vigencia_pdf", "liquido_pdf", "iof_pdf", "adicional_pdf", "total_pdf", "soma_pdf_ok", "parcelas_pdf", "apolices_citadas", "ligacao", "codigo_o2", "doc_situacao", "seguradora_doc", "doc_vigencia", "doc_liquido", "doc_iof", "doc_adicional", "doc_total", "doc_parcelas", "confere_vigencia", "confere_liquido", "confere_iof", "confere_total", "total_doc_igual_liq+iof+adic", "confere_parcelas", "comissao_msg", "doc_comissao", "confere_comissao", "observacao"];
  const linhas: string[] = [cab.map(csv).join(";")];
  const r = { mensagensComPdf: 0, pdfs: 0, principais: 0, auxiliares: 0, principaisLigados: 0, auxiliaresLigados: 0, endossosPelaApolice: 0, ambiguos: 0 };
  type Q = { n: number; liquidoSim: number; iofSim: number; totalSim: number; totalDocIgualLiquido: number; totalDocSomaOk: number; pdfSomaOk: number; pdfSomaDado: number };
  const quadro = new Map<string, Q>();
  for (const t of tarefas) {
    let chat: Awaited<ReturnType<typeof lerChatDaTarefa>>;
    try { chat = await lerChatDaTarefa(bx, Number(t.id)); } catch (e) { console.log(`erro tarefa ${t.id}: ${(e as Error).message.slice(0, 80)}`); continue; }
    const cnt = { pdfs: 0, principaisLigados: 0, auxiliaresLigados: 0 };
    for (const m of chat.mensagens) {
      const ids: number[] = m.params?.FILE_ID ?? [];
      const arquivos = ids.map((i) => chat.arquivos.get(i)).filter((f) => f && /\.pdf$/i.test(f.name ?? "")).slice(0, MAX_ARQ);
      if (!arquivos.length) continue;
      r.mensagensComPdf++;
      const p = lerMensagemCadastro(String(m.text ?? ""), { arquivos: ids.length, data: m.date ?? null, id: m.id, tarefa: Number(t.id) });
      const itens: Item[] = [];
      for (const f of arquivos) {
        r.pdfs++; cnt.pdfs++;
        let dados: DadosPdf | null = null; let obs = "";
        try {
          const buf = await comRetry(() => baixarPdf(f.id));
          if (!buf) obs = "download não devolveu PDF";
          else { const { t: texto, protegido } = await textoDoPdf(buf, []); if (!texto || texto.length < 50) obs = protegido ? "PDF protegido por senha" : "PDF sem texto (imagem)"; else dados = extrairDadosPdf(texto, f.name); }
        } catch (e) { obs = `erro: ${(e as Error).message.slice(0, 60)}`; }
        itens.push({ arquivo: f.name, dados, obs, ligacao: "nenhuma" });
      }
      // 1) principais
      let docMensagem: DocDoNome | undefined;
      for (const it of itens) {
        if (!it.dados || !PRINCIPAIS.has(it.dados.tipo)) continue;
        r.principais++;
        const d = it.dados;
        let docs: DocDoNome[] = [];
        for (const cpf of d.documentos.slice(0, 6)) docs.push(...(await comRetry(() => documentosDoCpf(cpf))));
        if (!docs.length && p?.nome) docs = await comRetry(() => documentosDoNome(sb, p.nome!));
        docs = [...new Map(docs.map((x) => [x.id, x])).values()];
        let cand = d.vigencia_inicio ? docs.filter((x) => x.vigencia_inicio && dias(x.vigencia_inicio, d.vigencia_inicio!) <= 1) : [];
        if (cand.length) it.ligacao = cand.length > 1 ? "cpf+vigência (mais de um doc)" : "cpf+vigência";
        else if (d.tipo === "endosso" || d.tipo === "certificado" || !d.vigencia_inicio) {
          const mae = await comRetry(() => documentosDaApolice(d.apolices_citadas));
          if (mae.length) {
            // prefere a mãe que também é do mesmo CPF
            const ids = new Set(docs.map((x) => x.id));
            cand = mae.filter((x) => ids.has(x.id));
            if (!cand.length) cand = mae;
            it.ligacao = "apólice citada"; if (d.tipo === "endosso") r.endossosPelaApolice++;
          } else if (docs.length === 1) { cand = docs; it.ligacao = "cpf (único documento)"; }
          else if (docs.length) it.ligacao = "só cpf/nome (sem vigência no PDF)";
        } else if (docs.length) it.ligacao = "só cpf/nome (vigência do PDF não bate)";
        if (cand.length > 1) r.ambiguos++;
        it.doc = cand.length ? cand.find((x) => !x.numero_apolice) ?? cand[0] : undefined;
        if (it.doc) { r.principaisLigados++; cnt.principaisLigados++; docMensagem ??= it.doc; }
      }
      // 2) auxiliares: ligam ao documento principal da mensagem
      for (const it of itens) {
        if (it.dados && PRINCIPAIS.has(it.dados.tipo)) continue;
        r.auxiliares++;
        if (docMensagem) { it.doc = docMensagem; it.ligacao = "auxiliar do documento principal da mensagem"; r.auxiliaresLigados++; cnt.auxiliaresLigados++; }
      }
      // linhas + comparação
      for (const it of itens) {
        const d = it.dados; const doc = it.doc; const principal = !!d && PRINCIPAIS.has(d.tipo);
        const seg = doc?.seguradora_id ? nomeSeg.get(doc.seguradora_id) ?? "" : "";
        const confVig = doc && principal && d?.vigencia_inicio ? (doc.vigencia_inicio && dias(doc.vigencia_inicio, d.vigencia_inicio) <= 1 && (!d.vigencia_fim || !doc.vigencia_fim || dias(doc.vigencia_fim, d.vigencia_fim) <= 1) ? "sim" : "não") : doc && principal ? "sem dado" : "";
        const confLiq = doc && principal ? igual(d?.premio_liquido, doc.premio_liquido) : "";
        const confIof = doc && principal ? igual(d?.iof, doc.iof) : "";
        const confTot = doc && principal ? igual(d?.premio_total, doc.premio_total) : "";
        const docSoma = doc && principal && doc.premio_liquido != null && doc.iof != null && d?.premio_total != null ? (Math.abs(Number(doc.premio_liquido) + Number(doc.iof) + Number(doc.premio_adicional ?? 0) - d.premio_total) < 0.06 ? "sim" : "não") : doc && principal ? "sem dado" : "";
        const confPar = doc && principal ? (d?.parcelas != null && doc.qtd_parcelas != null ? (Number(doc.qtd_parcelas) === d.parcelas ? "sim" : "não") : "sem dado") : "";
        const confCom = doc && p ? igual(p.comissao_pct, doc.comissao_pct) : "";
        if (doc && principal && d) {
          const q = quadro.get(seg || "(sem seguradora)") ?? quadro.set(seg || "(sem seguradora)", { n: 0, liquidoSim: 0, iofSim: 0, totalSim: 0, totalDocIgualLiquido: 0, totalDocSomaOk: 0, pdfSomaOk: 0, pdfSomaDado: 0 }).get(seg || "(sem seguradora)")!;
          q.n++;
          if (confLiq === "sim") q.liquidoSim++;
          if (confIof === "sim") q.iofSim++;
          if (confTot === "sim") q.totalSim++;
          if (doc.premio_total != null && doc.premio_liquido != null && Math.abs(Number(doc.premio_total) - Number(doc.premio_liquido)) < 0.06) q.totalDocIgualLiquido++;
          if (docSoma === "sim") q.totalDocSomaOk++;
          if (d.premio_soma_ok !== null) { q.pdfSomaDado++; if (d.premio_soma_ok) q.pdfSomaOk++; }
        }
        linhas.push([t.id, t.title, m.id, p?.nome, it.arquivo, principal ? "principal" : "auxiliar", d?.tipo ?? "", d?.vigencia_inicio ? `${d.vigencia_inicio}→${d.vigencia_fim ?? ""}` : "", d?.premio_liquido ?? "", d?.iof ?? "", d?.adicional_fracionamento ?? "", d?.premio_total ?? "", d?.premio_soma_ok ?? "", d?.parcelas ?? "", d?.apolices_citadas.join(" ") ?? "", it.ligacao, doc?.nosso_numero ?? "", doc?.situacao ?? "", seg, doc ? `${doc.vigencia_inicio ?? ""}→${doc.vigencia_fim ?? ""}` : "", doc?.premio_liquido ?? "", doc?.iof ?? "", doc?.premio_adicional ?? "", doc?.premio_total ?? "", doc?.qtd_parcelas ?? "", confVig, confLiq, confIof, confTot, docSoma, confPar, p?.comissao_pct ?? "", doc?.comissao_pct ?? "", confCom, it.obs].map(csv).join(";"));
      }
    }
    console.log(`${t.id} ${t.title.slice(0, 40)}: ${JSON.stringify(cnt)}`);
  }
  fs.writeFileSync(SAIDA, "﻿" + linhas.join("\n"));
  console.log(JSON.stringify(r));
  console.log("PRÊMIO POR SEGURADORA DO DOCUMENTO (PDF principal ligado): n | líquido igual | IOF igual | total igual | doc total==líquido | doc líq+IOF+adic==total do PDF | PDF fecha a soma (de quantos com dados)");
  for (const [k, q] of [...quadro].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(28)} ${q.n} | ${q.liquidoSim} | ${q.iofSim} | ${q.totalSim} | ${q.totalDocIgualLiquido} | ${q.totalDocSomaOk} | ${q.pdfSomaOk}/${q.pdfSomaDado}`);
  console.log("arquivo:", SAIDA);
})();
