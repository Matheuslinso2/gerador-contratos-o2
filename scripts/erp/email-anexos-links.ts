// FASE 2b dos anexos de e-mail: e-mails de seguradora que entregam o documento por LINK (sem PDF anexado). Hoje: Tokio ("Apólice Digital", "Cartão e Documentos Digitais": portal.tokiomarine.com.br)
// e Suhai ("a apólice do seu seguro já foi emitida": suhaiseguradora). Só baixa de endereços https da PRÓPRIA seguradora (lista fixa abaixo), só aceita PDF de verdade (%PDF-), até 20 MB, e
// guarda como <sha256>.pdf no bucket anexos-documentos + linha em erp_email_anexos (idx ≥ 100, fonte 'email_link'). Não liga a documento (isso é a fase 4, pelo conteúdo).
// Só leitura do Gmail; o arquivo é lido como texto, nunca executado.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/email-anexos-links.ts [--limite N] [--so TOKI|SUHA]
process.loadEnvFile(".env.local");
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { lerLinksDoEmail } from "@/lib/erp/emails";

const arg = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
const LIMITE = Number(arg("limite") ?? Infinity), SO = arg("so");
const sb = createServiceClient();
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);
// remetente da seguradora -> hosts de download permitidos
const SEGURADORAS: { abrev: string; de: string; hosts: RegExp; assunto?: string }[] = [
  { abrev: "TOKI", de: "tokiomarine", hosts: /^(portal|www)\.tokiomarine\.com\.br$/i, assunto: "assunto.ilike.%Digital%,assunto.ilike.%Ap_lice%,assunto.ilike.%Seguradora]%,assunto.ilike.%Documentos%" },
  { abrev: "SUHA", de: "suhai", hosts: /(^|\.)suhaiseguradora\.com(\.br)?$/i },
];

(async () => {
  const cont: Record<string, number> = {}; const c = (k: string) => (cont[k] = (cont[k] ?? 0) + 1);
  for (const s of SEGURADORAS.filter((x) => !SO || x.abrev === SO)) {
    let qm = sb.from("erp_emails").select("message_id,caixas,assunto").ilike("de", `%${s.de}%`).not("assunto", "ilike", "%Parecer de Cr%");
    if (s.assunto) qm = qm.or(s.assunto);
    const { data: ms } = await qm.order("data", { ascending: false }).limit(LIMITE === Infinity ? 5000 : LIMITE);
    // já tratados: mensagem com linha em erp_email_anexos de fonte email_link
    const { data: ja } = await sb.from("erp_email_anexos").select("message_id").eq("fonte", "email_link").limit(20000); const feitos = new Set((ja ?? []).map((x) => x.message_id));
    const alvo = (ms ?? []).filter((m) => !feitos.has(m.message_id));
    log(`${s.abrev}: ${alvo.length} e-mails a verificar por links`);
    for (const m of alvo) {
      let links: string[] = []; try { links = await lerLinksDoEmail(m.caixas[0], m.message_id, s.hosts); } catch { c(`${s.abrev}.erro_gmail`); continue; }
      if (!links.length) { c(`${s.abrev}.sem_link`); continue; }
      const linhas: Record<string, unknown>[] = []; let idx = 100;
      for (const u of links) {
        try {
          const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(40_000) });
          if (!res.ok || !/pdf/i.test(res.headers.get("content-type") ?? "")) { c(`${s.abrev}.link_nao_pdf`); continue; }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 20 * 1024 * 1024 || buf.slice(0, 5).toString("latin1") !== "%PDF-") { c(`${s.abrev}.link_nao_pdf`); continue; }
          const sha = createHash("sha256").update(buf).digest("hex");
          const { error: eu } = await sb.storage.from("anexos-documentos").upload(`${sha}.pdf`, buf, { contentType: "application/pdf", upsert: false });
          if (eu && !/exist|duplicate/i.test(eu.message)) throw new Error(eu.message);
          linhas.push({ message_id: m.message_id, idx: idx++, nome: `link-${s.abrev.toLowerCase()}-${sha.slice(0, 8)}.pdf`, mime: "application/pdf", bytes: buf.length, sha256: sha, storage_path: `${sha}.pdf`, classe: "nao_lido", classe_fonte: "nenhuma", fonte: "email_link" });
          c(`${s.abrev}.pdf_baixado`);
        } catch { c(`${s.abrev}.link_falhou`); }
      }
      if (linhas.length) { const { error } = await sb.from("erp_email_anexos").upsert(linhas, { onConflict: "message_id,idx", ignoreDuplicates: true }); if (error) console.log("registro:", error.message); await sb.from("erp_email_anexos_fila").upsert({ message_id: m.message_id, caixa: m.caixas[0], prioridade: 1, motivo: "documento por link da seguradora", estado: "baixado", n_pdfs: linhas.length }, { onConflict: "message_id" }); }
    }
  }
  log(`fim: ${JSON.stringify(cont)}`);
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
