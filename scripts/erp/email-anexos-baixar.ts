// FASE 2 dos anexos de e-mail: baixa os PDFs anexados (SÓ LEITURA do Gmail) na ordem da fila (erp_email_anexos_fila: prioridade 1 primeiro) para o bucket privado
// anexos-documentos como <sha256>.pdf (o mesmo PDF em várias mensagens/caixas ocupa 1 arquivo) e registra cada anexo em erp_email_anexos, SEM ligar a documento nenhum.
// Paralelismo baixo (padrão 3) e teto de bytes por rodada. Retomável: só pega estado 'pendente' (ou 'erro' com --refazer-erros).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/email-anexos-baixar.ts [--limite N] [--prioridade 1] [--paralelo 3] [--max-mb 2000]
process.loadEnvFile(".env.local");
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { baixarAnexosDoEmail } from "@/lib/erp/emails";

const arg = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
const LIMITE = Number(arg("limite") ?? Infinity), PARALELO = Number(arg("paralelo") ?? 3), MAX_MB = Number(arg("max-mb") ?? 3000);
const PRIORIDADE = arg("prioridade") ? Number(arg("prioridade")) : null;
const sb = createServiceClient();
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);

(async () => {
  const estados = process.argv.includes("--refazer-erros") ? ["pendente", "erro"] : ["pendente"];
  const fila: { message_id: string; caixa: string; prioridade: number }[] = [];
  for (let de = 0; fila.length < LIMITE; de += 1000) {
    let q = sb.from("erp_email_anexos_fila").select("message_id,caixa,prioridade").in("estado", estados).order("prioridade").order("message_id").range(de, de + 999);
    if (PRIORIDADE) q = q.eq("prioridade", PRIORIDADE);
    const { data, error } = await q; if (error) throw new Error(error.message);
    fila.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  const alvo = fila.slice(0, LIMITE);
  log(`fila: ${alvo.length} mensagens a baixar (paralelo ${PARALELO}, teto ${MAX_MB} MB)`);
  let i = 0, msgs = 0, pdfs = 0, novos = 0, bytes = 0, semPdf = 0, erros = 0; const t0 = Date.now();
  const trabalhar = async (f: (typeof alvo)[number]) => {
    try {
      const r = await baixarAnexosDoEmail(f.caixa, f.message_id);
      if (!r.achou) { await sb.from("erp_email_anexos_fila").update({ estado: "erro", erro: "mensagem não achada na caixa", atualizado_em: new Date().toISOString() }).eq("message_id", f.message_id); erros++; return; }
      const linhas: Record<string, unknown>[] = [];
      for (const p of r.pdfs) {
        const sha = createHash("sha256").update(p.buffer).digest("hex"); const caminho = `${sha}.pdf`;
        const { error: eu } = await sb.storage.from("anexos-documentos").upload(caminho, p.buffer, { contentType: "application/pdf", upsert: false });
        if (!eu) novos++; else if (!/exist|duplicate/i.test(eu.message)) throw new Error(`upload: ${eu.message}`);
        bytes += p.buffer.length; pdfs++;
        linhas.push({ message_id: f.message_id, idx: p.idx, nome: p.nome.slice(0, 200), mime: p.mime, bytes: p.buffer.length, sha256: sha, storage_path: caminho, classe: "nao_lido", classe_fonte: "nenhuma" });
      }
      if (linhas.length) { const { error } = await sb.from("erp_email_anexos").upsert(linhas, { onConflict: "message_id,idx", ignoreDuplicates: true }); if (error) throw new Error(`registro: ${error.message}`); }
      await sb.from("erp_email_anexos_fila").update({ estado: r.pdfs.length ? "baixado" : "sem_pdf", n_pdfs: r.pdfs.length, n_outros: r.outros, bytes_pdf: r.pdfs.reduce((s, p) => s + p.buffer.length, 0), erro: r.grandes ? `${r.grandes} PDF(s) acima de 15 MB não baixados` : null, atualizado_em: new Date().toISOString() }).eq("message_id", f.message_id);
      if (!r.pdfs.length) semPdf++; msgs++;
    } catch (e) {
      erros++; await sb.from("erp_email_anexos_fila").update({ estado: "erro", erro: String((e as Error).message).slice(0, 200), tentativas: 1, atualizado_em: new Date().toISOString() }).eq("message_id", f.message_id);
    }
    if ((msgs + erros) % 100 === 0) log(`  ${msgs + erros}/${alvo.length}: ${pdfs} PDFs (${novos} novos no bucket), ${Math.round(bytes / 1e6)} MB, ${semPdf} sem PDF, ${erros} erros, ${Math.round((Date.now() - t0) / 1000)} s`);
  };
  const worker = async () => { while (i < alvo.length && bytes / 1e6 < MAX_MB) await trabalhar(alvo[i++]); };
  await Promise.all(Array.from({ length: PARALELO }, worker));
  log(`fim: ${msgs} mensagens, ${pdfs} PDFs (${novos} novos no bucket, o resto já existia), ${Math.round(bytes / 1e6)} MB baixados, ${semPdf} sem PDF, ${erros} erros, ${Math.round((Date.now() - t0) / 1000)} s`);
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
