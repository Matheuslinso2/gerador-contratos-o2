// Carrega os extratos de pró-labore da Tokio enviados pelo Segimob ("[Seg Imob] - Extrato de Pró-labore Tokio Marine - <IMOB>")
// para erp_pro_labore_linhas e grava o % no documento (erp_pro_labore_aplicar_documentos). Gmail só leitura (conta de serviço,
// caixa matheus@). Extrato cuja soma não fecha com o total do cabeçalho NÃO é gravado. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-pro-labore-segimob.ts [desde AAAA/MM/DD] [--ensaio]
process.loadEnvFile(".env.local");
import { auth, gmail } from "@googleapis/gmail";
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha, candidatosSenhaO2 } from "@/lib/pdfComSenha";
import { lerExtratoProLabore } from "@/lib/erp/proLaboreSegimob";

const desde = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "2026/08/25";
const ensaio = process.argv.includes("--ensaio");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  const sb = createServiceClient();
  const jwt = new auth.JWT({ email: process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_EMAIL, key: process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n"), scopes: ["https://www.googleapis.com/auth/gmail.readonly"], subject: "matheus@o2seguros.com.br" });
  const g = gmail({ version: "v1", auth: jwt });
  const { data: tok } = await sb.from("erp_seguradoras").select("id").eq("abreviacao", "TOKI").single();
  const { data: imobs } = await sb.from("imobiliarias").select("id, nome, receita_razao_social, receita_nome_fantasia");
  // nome sem LTDA/ME/EIRELI etc., para a reserva por nome (a ligação principal é pelas apólices)
  const limpo = (n: string) => norm(n).replace(/(LTDA|ME|EPP|EIRELI|S A|SA|SS)/g, " ").replace(/s+/g, " ").trim();
  const porNome = new Map<string, string>();
  for (const i of (imobs ?? []) as { id: string; nome: string | null; receita_razao_social: string | null; receita_nome_fantasia: string | null }[])
    for (const n of [i.nome, i.receita_razao_social, i.receita_nome_fantasia]) if (n) porNome.set(limpo(n), i.id);
  const { data: ja } = await sb.from("erp_pro_labore_linhas").select("email_id");
  const lidos = new Set((ja ?? []).map((x: { email_id: string }) => x.email_id));

  const ids: string[] = [];
  let pagina: string | undefined;
  do {
    const r = await g.users.messages.list({ userId: "me", q: `subject:"Extrato de Pró-labore Tokio" after:${desde}`, maxResults: 100, pageToken: pagina });
    ids.push(...(r.data.messages ?? []).map((m) => m.id!));
    pagina = r.data.nextPageToken ?? undefined;
  } while (pagina);
  const res = { emails: ids.length, novos: 0, extratos: 0, linhas: 0, nao_fecha: [] as string[], sem_imob: new Set<string>(), sem_doc: 0 };
  for (const id of ids) {
    if (lidos.has(id)) continue;
    res.novos++;
    const m = await g.users.messages.get({ userId: "me", id, format: "full" });
    // imobiliária: a ligação que o ERP já fez para este e-mail (erp_emails, pelo Message-ID); o nome do PDF fica de reserva
    const msgId = m.data.payload?.headers?.find((h) => h.name?.toLowerCase() === "message-id")?.value ?? "";
    const { data: em } = msgId ? await sb.from("erp_emails").select("imobiliaria_id").eq("message_id", msgId).not("imobiliaria_id", "is", null).limit(1) : { data: null };
    const imobDoEmail = (em?.[0] as { imobiliaria_id: string } | undefined)?.imobiliaria_id ?? null;
    const partes: { filename?: string | null; body?: { attachmentId?: string | null } | null; parts?: unknown[] }[] = [];
    const perc = (p: any) => { if (!p) return; if (p.filename && p.body?.attachmentId && /\.pdf$/i.test(p.filename)) partes.push(p); (p.parts ?? []).forEach(perc); };
    perc(m.data.payload);
    for (const p of partes) {
      const a = await g.users.messages.attachments.get({ userId: "me", messageId: id, id: p.body!.attachmentId! });
      const texto = (await abrirTextoPdfComSenha(Buffer.from(a.data.data!, "base64url"), candidatosSenhaO2()))?.texto;
      if (!texto) { res.nao_fecha.push(`${p.filename}: PDF não abriu`); continue; }
      const ex = lerExtratoProLabore(texto);
      if (!ex.fecha && process.env.PL_DEBUG) (await import("node:fs")).writeFileSync(`${process.env.PL_DEBUG}/${p.filename}.txt`, texto);
      if (!ex.fecha) { res.nao_fecha.push(`${p.filename}: ${ex.linhas.length} linhas, soma ≠ total ${ex.total_bruto}`); continue; }
      res.extratos++;
      const aps = [...new Set(ex.linhas.map((l) => l.apolice))];
      const docs: { id: string; numero_apolice: string; imobiliaria_principal_id: string | null }[] = [];
      for (let i = 0; i < aps.length; i += 150) {
        const { data } = await sb.from("erp_documentos").select("id, numero_apolice, imobiliaria_principal_id").eq("seguradora_id", tok!.id).eq("tipo", "A").in("numero_apolice", aps.slice(i, i + 150));
        docs.push(...((data ?? []) as typeof docs));
      }
      const docDe = new Map(docs.map((d) => [d.numero_apolice, d.id]));
      // imobiliária: 1º a mais frequente nas apólices do extrato (cadastro do ERP); 2º a ligação do e-mail; 3º o nome do PDF
      const freq = new Map<string, number>();
      for (const d of docs) if (d.imobiliaria_principal_id) freq.set(d.imobiliaria_principal_id, (freq.get(d.imobiliaria_principal_id) ?? 0) + 1);
      const daApolice = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const imobId = daApolice ?? imobDoEmail ?? (ex.imobiliaria ? porNome.get(limpo(ex.imobiliaria)) ?? null : null);
      if (!imobId && ex.imobiliaria) res.sem_imob.add(ex.imobiliaria);
      const linhas = ex.linhas.map((l) => ({
        seguradora_id: tok!.id, imobiliaria_id: imobId, imobiliaria_nome: ex.imobiliaria ?? "?", documento_id: docDe.get(l.apolice) ?? null,
        apolice: l.apolice, codigo_venda: l.codigo_venda, segurado: l.segurado, parcela_n: l.parcela_n, parcelas_total: l.parcelas_total,
        premio_liquido: l.premio_liquido, valor_pro_labore: l.valor_pro_labore, produto: l.produto, data_pagamento: ex.data_pagamento,
        email_id: id, arquivo: p.filename,
      }));
      res.sem_doc += linhas.filter((l) => !l.documento_id).length;
      res.linhas += linhas.length;
      if (!ensaio && linhas.length) {
        const { error } = await sb.from("erp_pro_labore_linhas").upsert(linhas, { onConflict: "email_id,codigo_venda,parcela_n,apolice", ignoreDuplicates: true });
        if (error) res.nao_fecha.push(`${p.filename}: gravar: ${error.message}`);
      }
    }
  }
  if (!ensaio) { const { data } = await sb.rpc("erp_pro_labore_aplicar_documentos"); console.log("documentos atualizados:", data); }
  console.log(JSON.stringify({ ...res, sem_imob: [...res.sem_imob] }, null, 1));
})();
