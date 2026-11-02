// Levantamento (SÓ LEITURA) de COMO cada seguradora entrega o documento no e-mail: anexo PDF direto, anexo de outro tipo (ZIP etc.) ou link no corpo (e para qual endereço).
// Amostra de e-mails por seguradora (remetente da própria seguradora) e conta anexos/links; não baixa nem guarda nada.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/email-entrega-por-seguradora.ts [--por-seg 40]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { auth, gmail } from "@googleapis/gmail";

const POR_SEG = Number(process.argv.includes("--por-seg") ? process.argv[process.argv.indexOf("--por-seg") + 1] : 40);
const sb = createServiceClient();
const SEG: [string, string][] = [["TOKI", "tokiomarine"], ["PORT", "portoseguro"], ["ALF", "alfaseg"], ["YELU", "yelum|libertyseguros|libertyadm"], ["POTT", "pottencial"], ["ALLI", "allianz"], ["ZURI", "zurich"], ["BRAS", "brasilcap"], ["ICAT", "icatu"], ["HDI", "hdi\\.com"], ["MAPF", "mapfre"], ["SUHA", "suhai"], ["AZUL", "azulseguros"], ["SULA", "sulamerica"]];
const cliente = (caixa: string) => gmail({ version: "v1", auth: new auth.JWT({ email: process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_EMAIL, key: process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n"), scopes: ["https://www.googleapis.com/auth/gmail.readonly"], subject: caixa }) });

(async () => {
  for (const [abrev, re] of SEG) {
    const { data } = await sb.from("erp_emails").select("message_id,caixas,assunto,tem_anexo").or(re.split("|").map((r) => `de.ilike.%${r}%`).join(",")).order("data", { ascending: false }).limit(POR_SEG);
    // o filtro 'match' usa regex do Postgres (~); se não suportar, cai no ilike
    const msgs = data ?? [];
    if (!msgs.length) { console.log(`${abrev}: nenhum e-mail do remetente da seguradora nas caixas`); continue; }
    const t = { amostra: 0, pdf_anexo: 0, outro_anexo: 0, sem_anexo_com_link: 0, so_texto: 0 }; const hosts: Record<string, number> = {}; const tiposAnexo: Record<string, number> = {}; const assuntos: Record<string, number> = {};
    for (const m of msgs) {
      try {
        const g = cliente(m.caixas[0]);
        const r = await g.users.messages.list({ userId: "me", q: `rfc822msgid:${m.message_id.replace(/^<|>$/g, "")}`, maxResults: 1 }); const id = r.data.messages?.[0]?.id; if (!id) continue;
        const full = await g.users.messages.get({ userId: "me", id, format: "full" }); t.amostra++;
        let pdf = 0, outro = 0; const corpos: string[] = [];
        const walk = (p?: any) => { if (!p) return; if (p.filename && p.body?.attachmentId) { if (/pdf/i.test(p.mimeType) || /\.pdf$/i.test(p.filename)) pdf++; else { outro++; const ext = (p.filename.split(".").pop() ?? "?").toLowerCase().slice(0, 5); tiposAnexo[ext] = (tiposAnexo[ext] ?? 0) + 1; } } if (/^text\/(html|plain)/i.test(p.mimeType ?? "") && p.body?.data) corpos.push(Buffer.from(p.body.data, "base64url").toString("utf8")); (p.parts ?? []).forEach(walk); };
        walk(full.data.payload);
        const links = new Set<string>(); for (const c of corpos) for (const x of c.matchAll(/href=["'](https:\/\/[^"']+)["']/gi)) { try { links.add(new URL(x[1].replace(/&amp;/g, "&")).host); } catch { /* ignora */ } }
        const uteis = [...links].filter((h) => !/apple\.com|google\.com|facebook|instagram|linkedin|youtube|twitter|w3\.org|schema\.org/i.test(h));
        if (pdf) t.pdf_anexo++; if (outro) t.outro_anexo++; if (!pdf && uteis.length) t.sem_anexo_com_link++; if (!pdf && !outro && !uteis.length) t.so_texto++;
        if (!pdf) for (const h of uteis) hosts[h] = (hosts[h] ?? 0) + 1;
        const a = (m.assunto ?? "").replace(/\d+/g, "#").slice(0, 60); assuntos[a] = (assuntos[a] ?? 0) + 1;
      } catch (e) { /* mensagem não achada */ }
    }
    const top = (o: Record<string, number>, n = 4) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join(", ");
    console.log(`${abrev}: ${JSON.stringify(t)} | links (e-mails sem PDF): ${top(hosts) || "-"} | outros anexos: ${top(tiposAnexo) || "-"} | assuntos: ${top(assuntos, 3)}`);
  }
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
