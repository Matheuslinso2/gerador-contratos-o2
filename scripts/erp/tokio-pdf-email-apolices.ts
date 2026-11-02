// Apólices Tokio (Fiança, set/out 2026 por padrão) com nº no ERP mas SEM PDF guardado: acha o e-mail da Tokio "Apólice Digital 0746.<nº>" (assunto traz o nº), baixa o PDF anexo (só leitura do Gmail),
// confere (CPF de parte do documento + nº da apólice ou vigência) e guarda como anexo tipo 'apolice' em erp_documento_anexos (bucket privado anexos-documentos). Depois o leitor local de apólice
// (scripts/erp/ler-apolices-vigentes-pdf.ts TOKI; texto nativo, sem IA) grava os campos em erp_apolice_pdf_campos. Ensaio por padrão; --gravar grava.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/tokio-pdf-email-apolices.ts [--nn 133530,...] [--de 2026-09-01 --ate 2026-10-31] [--gravar]
process.loadEnvFile(".env.local");
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { lerAnexosPdf, lerLinksDoEmail } from "@/lib/erp/emails";
import { avaliar, guardarAnexo, textoDoPdf, type DocAlvo } from "@/lib/erp/anexosEmail";

const arg = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
const GRAVAR = process.argv.includes("--gravar");
const NNS = arg("nn")?.split(",").map(Number);
const DE = arg("de") ?? "2026-09-01", ATE = arg("ate") ?? "2026-10-31";
const sb = createServiceClient();
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");

(async () => {
  let q = sb.from("erp_documentos").select("id,nosso_numero,nosso_numero_corp,numero_apolice,numero_proposta,vigencia_inicio,locatario_id,seguradora:erp_seguradoras!inner(abreviacao),ramo:erp_ramos!inner(produto)").eq("seguradora.abreviacao", "TOKI").eq("ramo.produto", "fianca").in("tipo", ["A", "C"]).not("numero_apolice", "is", null);
  q = NNS ? q.in("nosso_numero_corp", NNS) : q.or(`and(vigencia_inicio.gte.${DE},vigencia_inicio.lte.${ATE}),and(dt_proposta.gte.${DE},dt_proposta.lte.${ATE})`);
  const { data: docs, error } = await q; if (error) throw new Error(error.message);
  const ids = (docs ?? []).map((d) => d.id);
  const { data: ax } = ids.length ? await sb.from("erp_documento_anexos").select("documento_id").eq("tipo", "apolice").in("documento_id", ids) : { data: [] };
  const comAnexo = new Set((ax ?? []).map((a) => a.documento_id));
  const alvo = (docs ?? []).filter((d) => NNS || !comAnexo.has(d.id));
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${docs?.length} apólices Tokio Fiança no recorte; ${comAnexo.size} já têm PDF guardado; ${alvo.length} a buscar no e-mail`);
  const r: Record<string, number> = {};
  const c = (k: string) => (r[k] = (r[k] ?? 0) + 1);
  for (const d of alvo) {
    const n = dig(d.numero_apolice).replace(/^0+/, "");
    const { data: ms } = await sb.from("erp_emails").select("message_id,caixas,assunto,data,tem_anexo").eq("tem_anexo", true).ilike("assunto", `%Ap_lice Digital%${n}%`).order("data", { ascending: false }).limit(5);
    const m = (ms ?? []).find((x) => dig(x.assunto).endsWith(n) || dig(x.assunto).includes(n));
    if (!m) { c("sem_email"); console.log(`  ${d.nosso_numero_corp}: sem e-mail "Apólice Digital" com o nº`); continue; }
    // CPFs das partes do documento (para confirmar o PDF)
    const { data: lo } = d.locatario_id ? await sb.from("locatarios").select("cpf").eq("id", d.locatario_id) : { data: [] };
    const { data: partes } = await sb.from("erp_doc_partes_acervo").select("locatario:locatarios(cpf)").eq("documento_id", d.id);
    const cpfs = [...new Set([...(lo ?? []).map((l) => dig(l.cpf)), ...((partes ?? []) as unknown as { locatario: { cpf: string | null } | null }[]).map((p) => dig(p.locatario?.cpf))].filter((x) => x.length >= 11))];
    let achou = false;
    for (const caixa of m.caixas.slice(0, 3)) {
      let pdfs: { nome: string; buffer: Buffer }[] = [];
      try { pdfs = await lerAnexosPdf(caixa, m.message_id); } catch { /* segue para os links */ }
      if (!pdfs.length) {
        // o e-mail "Apólice Digital" da Tokio não traz anexo: traz links do portal da própria Tokio (apólice protegida pelo CPF, cartão, condições gerais)
        let links: string[] = []; try { links = await lerLinksDoEmail(caixa, m.message_id, /(^|\.)tokiomarine\.com\.br$/i); } catch { continue; }
        for (const u of links) {
          try {
            const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(40_000) });
            if (!res.ok || !/pdf/i.test(res.headers.get("content-type") ?? "")) continue;
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.length > 20 * 1024 * 1024 || buffer.slice(0, 5).toString("latin1") !== "%PDF-") continue;
            pdfs.push({ nome: `apolice-tokio-${n}-${createHash("sha256").update(buffer).digest("hex").slice(0, 8)}.pdf`, buffer });
          } catch { /* link expirado ou fora do ar */ }
        }
      }
      if (!pdfs.length) continue;
      for (const p of pdfs) {
        const r0 = await textoDoPdf(p.buffer, cpfs); const t = (r0.t ?? "").replace(/\s+/g, " ");
        if (t.length < 100) { c("pdf_sem_texto"); continue; }
        const alvoDoc: DocAlvo = { id: d.id, nosso_numero: d.nosso_numero, numero_apolice: d.numero_apolice, numero_proposta: d.numero_proposta, vigencia_inicio: d.vigencia_inicio, cpfs } as DocAlvo;
        const av = avaliar(t, alvoDoc);
        if (!av) { c("pdf_nao_confere"); console.log(`  ${d.nosso_numero_corp}: PDF do e-mail não confirma o documento (nem CPF nem nº)`); continue; }
        achou = true; c(av.situacao);
        console.log(`  ${d.nosso_numero_corp}: ${av.situacao} (cpf ${av.cpf ? "s" : "n"} nº ${av.num ? "s" : "n"} vig ${av.vig ? "s" : "n"}) ${p.nome.slice(0, 40)}`);
        if (GRAVAR && av.situacao === "confirmada" && /Pr[eê]mio/i.test(t)) await guardarAnexo(sb, { doc: { id: d.id }, pdf: p.buffer, nome: p.nome, messageId: m.message_id, tipo: "apolice", av, texto: t, extra: { fonte: "email_tokio_apolice_digital", sha_conferido: createHash("sha256").update(p.buffer).digest("hex").slice(0, 12) } });
      }
      if (achou) break;
    }
    if (!achou && !r.sem_email) c("sem_pdf_valido");
  }
  console.log(JSON.stringify(r));
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
