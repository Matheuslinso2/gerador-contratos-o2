// Certificados de Capitalização nos chats das tarefas "CADASTRO CAPITALIZAÇÃO CORP" / "CADASTRO RENOVAÇÃO CAP" do Bitrix. SÓ LEITURA no Bitrix e
// no banco; ensaio (nada guardado nem gravado; PDFs só em memória). Mesma regra de ligação dos e-mails (certificadoCap.ts). uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/certificados-bitrix.ts [--desde 2024-05-01] [--saida arquivo.json]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { guardarAnexo, textoDoPdf } from "@/lib/erp/anexosEmail";
import { chamadorBitrix, lerChatDaTarefa, listarTarefas } from "@/lib/erp/tarefaCadastro";
import { carregarCapVigentes, ehCertificado, lerCertificado, ligarCertificado } from "./certificadoCap";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const DESDE = arg("desde") ?? "2024-05-01";
const ANT = arg("anteriores-csv"); // CSV dos documentos anteriores (vencidos) a procurar; Código O2 na 3ª coluna
const SAIDA = arg("saida") ?? path.join(os.tmpdir(), ANT ? "certificados-bitrix-anteriores.json" : "certificados-bitrix.json");
const GUARDAR = process.argv.includes("--guardar"); // guarda os PDFs de vínculo confirmado como anexo do documento
let guardados = 0;
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
const sb = createServiceClient();
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function comRetry<T>(fn: () => Promise<T>): Promise<T> { for (let t = 0; ; t++) { try { return await fn(); } catch (e) { if (t >= 4) throw e; await pausa(2000 * (t + 1)); } } }

(async () => {
  const codigos = ANT ? fs.readFileSync(ANT, "utf8").split("\n").slice(1).map((l) => Number(l.split(";")[2]?.replace(/"/g, ""))).filter(Boolean) : undefined;
  const ind = await carregarCapVigentes(sb, true, codigos);
  const porSeg: Record<string, number> = {};
  for (const d of ind.vigentes) { const k = ind.nomeSeguradora.get(d.seguradora_id!) ?? "?"; porSeg[k] = (porSeg[k] ?? 0) + 1; }
  console.log(`Capitalização vigente no ERP: ${ind.vigentes.length} | ${JSON.stringify(porSeg)}`);
  const tarefas = (await listarTarefas(bx, "CADASTRO", 2000)).filter((t) => /CAPITALIZA|\bCAP\b/i.test(t.title) && String(t.createdDate).slice(0, 10) >= DESDE);
  console.log(`tarefas de Capitalização desde ${DESDE}: ${tarefas.length}`);
  const achados = new Map<string, { nosso_numero: number; situacao: string; tarefa: number; arquivo: string; inicio: string | null; meses: number | null; fim_calculado: string | null; fim_erp: string | null; fim_confere: boolean | null }>();
  const r = { pdfs: 0, certificados: 0, semNumeroEmDoc: 0, semTexto: 0 };
  for (const t of tarefas) {
    let chat;
    try { chat = await lerChatDaTarefa(bx, Number(t.id)); } catch (e) { console.log(`erro tarefa ${t.id}: ${(e as Error).message.slice(0, 60)}`); continue; }
    for (const f of chat.arquivos.values()) {
      if (!/\.pdf$/i.test(f.name ?? "")) continue;
      r.pdfs++;
      try {
        const g = await bx("disk.file.get", { id: f.id });
        if (!g.result?.DOWNLOAD_URL) continue;
        const buf = Buffer.from(await (await comRetry(() => fetch(g.result.DOWNLOAD_URL, { signal: AbortSignal.timeout(60_000) }))).arrayBuffer());
        if (buf.subarray(0, 4).toString() !== "%PDF") continue;
        const { t: texto } = await textoDoPdf(buf, []);
        if (!texto || texto.length < 40) { r.semTexto++; continue; }
        if (!ehCertificado(texto)) continue;
        r.certificados++;
        const c = lerCertificado(texto);
        const ligs = ligarCertificado(ind, texto.replace(/\s+/g, " "), c);
        if (!ligs.length) { r.semNumeroEmDoc++; continue; }
        for (const l of ligs) {
          // --guardar: só vínculo CONFIRMADO vira anexo do documento (bucket privado + erp_documento_anexos, origem bitrix)
          if (GUARDAR && l.situacao === "confirmada") {
            await comRetry(() => guardarAnexo(sb, { doc: { id: l.doc.id }, pdf: buf, nome: f.name, messageId: `bitrix:tarefa:${t.id}:arquivo:${f.id}`, tipo: "certificado", origem: "bitrix", av: { situacao: "confirmada", cpf: l.porCpf, num: l.via === "numero", vig: l.porData }, extra: { fonte: "tarefa Bitrix", tarefa: Number(t.id), inicio: c.inicio, meses: c.meses } }));
            guardados++;
          }
          const antes = achados.get(l.doc.id);
          if (!antes || (antes.situacao === "provavel" && l.situacao === "confirmada"))
            achados.set(l.doc.id, { nosso_numero: l.doc.nosso_numero, situacao: l.situacao, tarefa: Number(t.id), arquivo: f.name, inicio: c.inicio, meses: c.meses, fim_calculado: c.fim, fim_erp: l.doc.vigencia_fim, fim_confere: l.fimConfere });
        }
      } catch (e) { console.log(`erro arquivo ${f.name}: ${(e as Error).message.slice(0, 60)}`); }
    }
  }
  const lista = [...achados.values()];
  const conf = lista.filter((x) => x.situacao === "confirmada").length;
  const comFim = lista.filter((x) => x.fim_confere !== null);
  const modos: Record<string, number> = {};
  for (const x of lista) modos[String(x.meses ?? "?")] = (modos[String(x.meses ?? "?")] ?? 0) + 1;
  const quadro: Record<string, { vigentes: number; ligados: number }> = {};
  for (const d of ind.vigentes) { const k = ind.nomeSeguradora.get(d.seguradora_id!) ?? "?"; const q = (quadro[k] ??= { vigentes: 0, ligados: 0 }); q.vigentes++; if (achados.has(d.id)) q.ligados++; }
  fs.writeFileSync(SAIDA, JSON.stringify(lista, null, 1));
  console.log(JSON.stringify(r));
  if (GUARDAR) console.log(`ANEXOS GUARDADOS (vínculo confirmado): ${guardados}`);
  console.log(`LIGADOS pelos chats do Bitrix: ${lista.length} documentos vigentes (confirmada ${conf}, provável ${lista.length - conf}) de ${ind.vigentes.length}`);
  console.log("POR SEGURADORA:", JSON.stringify(quadro));
  console.log(`MODO DE REAPLICAÇÃO (meses): ${JSON.stringify(modos)} | fim calculado = fim do ERP em ${comFim.filter((x) => x.fim_confere).length} de ${comFim.length}`);
  console.log("arquivo:", SAIDA);
})();
