import "server-only";

import { createHash } from "node:crypto";
import { auth, gmail, gmail_v1 } from "@googleapis/gmail";
import type { SupabaseClient } from "@supabase/supabase-js";

// ERP O2 — e-mails ligados a imobiliárias e apólices (27/10/2026), SÓ LEITURA.
// Usa a conta de serviço "gestao-emails-o2" (delegação no domínio). Lê somente cabeçalhos e o trecho (snippet) das
// mensagens que envolvem clientes ativos; corpo e anexos não são copiados. `subject` vem SEMPRE desta lista fixa:
// nunca virar parâmetro vindo de fora.
export const CAIXAS_O2 = [
  "amanda", "ana.ingrid", "analisepwb", "andre", "lucas", "beatriz", "bianca", "brenda", "bruna", "carlos", "carolina",
  "cassia", "dayane", "elias", "fabricio", "gabriel", "henrique", "isabelle", "jessika", "kamila", "kelly", "livia",
  "matheus", "natalia", "nathalie", "patricia", "rayane", "vanessa", "odo", "victoria", "viniciusmaia", "vitoriamachado",
  "will.pereira", "william",
].map((c) => `${c}@o2seguros.com.br`);

const ESCOPO = ["https://www.googleapis.com/auth/gmail.readonly"];

function clienteDaCaixa(caixa: string): gmail_v1.Gmail {
  if (!CAIXAS_O2.includes(caixa)) throw new Error(`Caixa fora da lista autorizada: ${caixa}`);
  const email = process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const chave = process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !chave) throw new Error("Faltam GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY");
  const jwt = new auth.JWT({ email, key: chave.replace(/\\n/g, "\n"), scopes: ESCOPO, subject: caixa });
  return gmail({ version: "v1", auth: jwt });
}

export type EmailLido = {
  message_id: string;
  thread_id: string | null;
  caixa: string;
  data: string | null;
  de: string;
  para: string;
  cc: string;
  assunto: string;
  trecho: string;
  tem_anexo: boolean;
};

const cab = (m: gmail_v1.Schema$Message, nome: string) =>
  m.payload?.headers?.find((h) => h.name?.toLowerCase() === nome)?.value ?? "";

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Repete com espera crescente quando o Gmail devolve limite de cota (429 / 403 rateLimit / 5xx). */
async function comRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let t = 0; ; t++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as { code?: number | string; message?: string };
      const cota = err.code === 429 || /rate|quota/i.test(err.message ?? "") || (Number(err.code) >= 500 && Number(err.code) < 600);
      if (!cota || t >= 5) throw e;
      await dorme(1500 * 2 ** t + Math.random() * 500);
    }
  }
}

/** Lê (cabeçalhos + trecho) as mensagens de uma caixa que batem com a busca do Gmail. `truncado` = havia mais que o limite. */
export async function lerCaixa(caixa: string, q: string, limite: number): Promise<{ mensagens: EmailLido[]; truncado: boolean }> {
  const g = clienteDaCaixa(caixa);
  const ids: string[] = [];
  let pagina: string | undefined;
  let truncado = false;
  do {
    const r = await comRetry(() =>
      g.users.messages.list({ userId: "me", q, maxResults: Math.min(500, limite - ids.length), pageToken: pagina })
    );
    ids.push(...(r.data.messages ?? []).map((m) => m.id!));
    pagina = r.data.nextPageToken ?? undefined;
    if (pagina && ids.length >= limite) truncado = true;
  } while (pagina && ids.length < limite);
  const mensagens: EmailLido[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const lote = await Promise.all(
      ids.slice(i, i + 10).map((id) =>
        comRetry(() =>
          g.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Message-ID", "From", "To", "Cc", "Subject", "Date"] })
        )
          .then((r) => r.data)
          .catch(() => null)
      )
    );
    for (const m of lote) {
      if (!m) continue;
      const mid = cab(m, "message-id").trim() || `gmail:${caixa}:${m.id}`;
      const d = cab(m, "date");
      mensagens.push({
        message_id: mid,
        thread_id: m.threadId ?? null,
        caixa,
        data: d && !isNaN(Date.parse(d)) ? new Date(d).toISOString() : m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
        de: cab(m, "from").slice(0, 300),
        para: cab(m, "to").slice(0, 600),
        cc: cab(m, "cc").slice(0, 600),
        assunto: cab(m, "subject").slice(0, 300),
        trecho: (m.snippet ?? "").slice(0, 300),
        tem_anexo: (m.payload?.mimeType ?? "").startsWith("multipart/mixed"),
      });
    }
  }
  return { mensagens, truncado };
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
export const extrairEmails = (v: unknown): string[] => {
  const s = Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : "";
  return [...new Set((s.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
};

const DOMINIOS_IGNORADOS = ["o2seguros.com.br"];

/** E-mails de uma imobiliária que servem de chave (nunca os da própria O2). */
export const emailsDaImobiliaria = (i: Record<string, unknown>): string[] =>
  [...new Set([i.email, i.email_faturas, i.email_repasses, i.email_campanhas].flatMap(extrairEmails))].filter(
    (e) => !DOMINIOS_IGNORADOS.some((d) => e.endsWith("@" + d))
  );

/** O nº da apólice aparece como número inteiro (sem dígitos colados antes/depois). */
function contemNumero(texto: string, num: string): boolean {
  for (let i = texto.indexOf(num); i >= 0; i = texto.indexOf(num, i + 1)) {
    if (!/\d/.test(texto[i - 1] ?? "") && !/\d/.test(texto[i + num.length] ?? "")) return true;
  }
  return false;
}

export type ResumoEmails = {
  imobiliarias: number;
  emailsChave: number;
  emailsCompartilhados: number;
  lotes: number;
  pares: number;
  pulados: number;
  lidos: number;
  gravados: number;
  ligadosApolice: number;
  truncados: number;
  erros: string[];
};

type Imob = { id: string; nome: string; email: string | null; email_faturas: string[] | null; email_repasses: string[] | null; email_campanhas: string[] | null };

async function lerTudo<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pagina(de, de + 999);
    if (error) throw new Error(error.message);
    todas.push(...(data ?? []));
    if ((data ?? []).length < 1000) return todas;
  }
}

/**
 * Indexa os e-mails das caixas O2 que envolvem clientes ativos. Agrupa `tamanhoLote` e-mails de imobiliárias por busca
 * (uma busca Gmail por caixa × lote), grava uma linha por Message-ID em erp_emails e liga à imobiliária (e-mail do
 * remetente/destinatário) e ao documento (nº da apólice no assunto/trecho). O progresso fica em erp_emails_progresso:
 * rodar de novo pula o que já foi lido.
 */
export async function indexarEmailsDeImobiliarias(
  sb: SupabaseClient,
  o: {
    nome?: string;
    escopo: "vigentes" | "todas";
    dias: number;
    limitePorBusca: number;
    tamanhoLote: number;
    paralelo: number;
    caixas?: string[];
    log?: (m: string) => void;
  }
): Promise<ResumoEmails> {
  const log = o.log ?? (() => {});
  const resumo: ResumoEmails = {
    imobiliarias: 0, emailsChave: 0, emailsCompartilhados: 0, lotes: 0, pares: 0, pulados: 0, lidos: 0, gravados: 0, ligadosApolice: 0, truncados: 0, erros: [],
  };

  // 1) imobiliárias no escopo
  let ids: string[] | null = null;
  if (o.escopo === "vigentes") {
    const linhas = await lerTudo<{ imobiliaria_principal_id: string | null }>((a, b) =>
      sb.from("erp_documentos").select("imobiliaria_principal_id").eq("situacao", "vigente").not("imobiliaria_principal_id", "is", null).order("id").range(a, b)
    );
    ids = [...new Set(linhas.map((l) => l.imobiliaria_principal_id!))];
  }
  const imobs: Imob[] = [];
  if (ids) {
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await sb.from("imobiliarias").select("id,nome,email,email_faturas,email_repasses,email_campanhas").in("id", ids.slice(i, i + 100));
      if (error) throw new Error(error.message);
      imobs.push(...((data ?? []) as Imob[]));
    }
  } else {
    imobs.push(...((await lerTudo<Imob>((a, b) => sb.from("imobiliarias").select("id,nome,email,email_faturas,email_repasses,email_campanhas").order("id").range(a, b))) as Imob[]));
  }
  const filtro = o.nome?.toLowerCase();
  const alvo = imobs.filter((i) => !filtro || i.nome.toLowerCase().includes(filtro));

  // 2) e-mail -> imobiliária (e-mail compartilhado por 2+ fichas não serve de chave: ligaria errado)
  const donos = new Map<string, Set<string>>();
  for (const i of alvo) {
    const es = emailsDaImobiliaria(i);
    if (es.length) resumo.imobiliarias++;
    for (const e of es) (donos.get(e) ?? donos.set(e, new Set()).get(e)!).add(i.id);
  }
  const chave = new Map<string, string[]>();
  for (const [e, d] of donos) {
    chave.set(e, [...d]);
    if (d.size > 1) resumo.emailsCompartilhados++;
  }
  resumo.emailsChave = chave.size;

  // 3) documentos com nº de apólice, por imobiliária
  const docsPorImob = new Map<string, { id: string; num: string; vigente: boolean }[]>();
  const idsAlvo = [...new Set([...chave.values()].flat())];
  for (let i = 0; i < idsAlvo.length; i += 50) {
    const grupo = idsAlvo.slice(i, i + 50);
    const docs = await lerTudo<{ id: string; numero_apolice: string; situacao: string; imobiliaria_principal_id: string }>((a, b) =>
      sb.from("erp_documentos").select("id,numero_apolice,situacao,imobiliaria_principal_id").in("imobiliaria_principal_id", grupo).not("numero_apolice", "is", null).order("id").range(a, b)
    );
    for (const d of docs) {
      const num = (d.numero_apolice ?? "").trim();
      if (num.length < 6) continue;
      (docsPorImob.get(d.imobiliaria_principal_id) ?? docsPorImob.set(d.imobiliaria_principal_id, []).get(d.imobiliaria_principal_id)!).push({ id: d.id, num, vigente: d.situacao === "vigente" });
    }
  }

  // 4) lotes e progresso
  const emails = [...chave.keys()].sort();
  const lotes: { chave: string; emails: string[] }[] = [];
  for (let i = 0; i < emails.length; i += o.tamanhoLote) {
    const es = emails.slice(i, i + o.tamanhoLote);
    lotes.push({ chave: createHash("sha1").update(`${o.dias}|${es.join(",")}`).digest("hex").slice(0, 16), emails: es });
  }
  resumo.lotes = lotes.length;
  const caixas = (o.caixas ?? CAIXAS_O2).filter((c) => CAIXAS_O2.includes(c));
  const feitos = new Set<string>();
  for (const l of await lerTudo<{ caixa: string; lote: string }>((a, b) => sb.from("erp_emails_progresso").select("caixa,lote").order("caixa").order("lote").range(a, b))) feitos.add(`${l.caixa}|${l.lote}`);
  const pendentes = new Map<string, typeof lotes>();
  for (const c of caixas) {
    const falta = lotes.filter((l) => !feitos.has(`${c}|${l.chave}`));
    resumo.pares += falta.length;
    resumo.pulados += lotes.length - falta.length;
    if (falta.length) pendentes.set(c, falta);
  }
  log(`${resumo.imobiliarias} imobiliárias, ${emails.length} e-mails-chave (${resumo.emailsCompartilhados} compartilhados ignorados), ${lotes.length} lotes x ${caixas.length} caixas; a fazer ${resumo.pares}, já feitos ${resumo.pulados}`);

  // 5) grava (uma fila só, para unir as caixas de uma mesma mensagem sem corrida)
  let fila: Promise<unknown> = Promise.resolve();
  const ligadosVistos = new Set<string>();
  const gravar = (caixa: string, loteChave: string, msgs: EmailLido[], truncado: boolean) => {
    fila = fila.then(async () => {
      const porMsg = new Map<string, EmailLido>();
      for (const m of msgs) porMsg.set(m.message_id, m);
      const lista = [...porMsg.values()];
      const antigas = new Map<string, string[]>();
      for (let i = 0; i < lista.length; i += 100) {
        const { data, error } = await sb.from("erp_emails").select("message_id,caixas").in("message_id", lista.slice(i, i + 100).map((m) => m.message_id));
        if (error) throw new Error(`erp_emails: ${error.message}`);
        for (const r of data ?? []) antigas.set(r.message_id, r.caixas ?? []);
      }
      const linhas = lista.map((m) => {
        const candidatas = [...new Set([...extrairEmails(m.de), ...extrairEmails(m.para), ...extrairEmails(m.cc)].flatMap((e) => chave.get(e) ?? []))];
        const texto = `${m.assunto} ${m.trecho}`;
        // o nº da apólice decide a ficha quando há mais de uma candidata
        const achados = candidatas.flatMap((id) => (docsPorImob.get(id) ?? []).filter((d) => contemNumero(texto, d.num)).map((d) => ({ ...d, imob: id })));
        const doc = achados.find((d) => d.vigente) ?? achados[0];
        const imobId = doc?.imob ?? (candidatas.length === 1 ? candidatas[0] : null);
        const ambigua = !imobId && candidatas.length > 1;
        if (doc) ligadosVistos.add(m.message_id);
        return {
          message_id: m.message_id,
          thread_id: m.thread_id,
          caixas: [...new Set([...(antigas.get(m.message_id) ?? []), caixa])],
          data: m.data, de: m.de, para: m.para, cc: m.cc, assunto: m.assunto, trecho: m.trecho, tem_anexo: m.tem_anexo,
          imobiliaria_id: imobId,
          imobiliarias_candidatas: candidatas,
          documento_id: doc?.id ?? null,
          ligacao: [...(imobId ? ["email_imobiliaria"] : []), ...(doc ? ["numero_apolice"] : []), ...(ambigua ? ["ambigua_email_compartilhado"] : [])],
        };
      });
      for (let i = 0; i < linhas.length; i += 200) {
        const { error } = await sb.from("erp_emails").upsert(linhas.slice(i, i + 200), { onConflict: "message_id" });
        if (error) throw new Error(`erp_emails: ${error.message}`);
      }
      const { error } = await sb.from("erp_emails_progresso").upsert({ caixa, lote: loteChave, dias: o.dias, lidos: msgs.length, truncado }, { onConflict: "caixa,lote" });
      if (error) throw new Error(`progresso: ${error.message}`);
      resumo.gravados += linhas.length;
    });
    return fila;
  };

  // 6) caixas em paralelo (a cota do Gmail é por usuário); dentro de cada caixa, lote a lote
  const fila_caixas = [...pendentes.keys()];
  let feitosPares = 0;
  const trabalhador = async () => {
    for (let c = fila_caixas.shift(); c; c = fila_caixas.shift()) {
      for (const l of pendentes.get(c)!) {
        const busca = `{${l.emails.map((e) => `from:${e} to:${e} cc:${e}`).join(" ")}} newer_than:${o.dias}d`;
        try {
          const { mensagens, truncado } = await lerCaixa(c, busca, o.limitePorBusca);
          resumo.lidos += mensagens.length;
          if (truncado) resumo.truncados++;
          await gravar(c, l.chave, mensagens, truncado);
        } catch (e) {
          resumo.erros.push(`${c} lote ${l.chave}: ${(e as Error).message.slice(0, 100)}`);
          if (/delegation|unauthorized_client|invalid_grant|Caixa fora/i.test((e as Error).message)) break; // caixa inacessível: não insiste
        }
        feitosPares++;
        if (feitosPares % 25 === 0) log(`${feitosPares}/${resumo.pares} pares, ${resumo.lidos} lidos, ${resumo.gravados} gravados, ${resumo.erros.length} erros`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.paralelo) }, trabalhador));
  await fila;
  resumo.ligadosApolice = ligadosVistos.size;
  return resumo;
}

export type AnexoPdf = { nome: string; buffer: Buffer };

/** Baixa (só leitura) os PDFs anexados a uma mensagem de uma caixa O2. Acha a mensagem pelo Message-ID. Máx. 15 MB por arquivo. */
export async function lerAnexosPdf(caixa: string, messageId: string): Promise<AnexoPdf[]> {
  const g = clienteDaCaixa(caixa);
  let id: string | null = null;
  const sintetico = /^gmail:[^:]+:(.+)$/.exec(messageId);
  if (sintetico) id = sintetico[1];
  else {
    const r = await comRetry(() => g.users.messages.list({ userId: "me", q: `rfc822msgid:${messageId.replace(/^<|>$/g, "")}`, maxResults: 1 }));
    id = r.data.messages?.[0]?.id ?? null;
  }
  if (!id) return [];
  const m = await comRetry(() => g.users.messages.get({ userId: "me", id: id!, format: "full" }));
  const partes: gmail_v1.Schema$MessagePart[] = [];
  const percorrer = (p?: gmail_v1.Schema$MessagePart) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId && (/pdf/i.test(p.mimeType ?? "") || /\.pdf$/i.test(p.filename))) partes.push(p);
    (p.parts ?? []).forEach(percorrer);
  };
  percorrer(m.data.payload);
  const saida: AnexoPdf[] = [];
  for (const p of partes) {
    if ((p.body?.size ?? 0) > 15 * 1024 * 1024) continue;
    const a = await comRetry(() => g.users.messages.attachments.get({ userId: "me", messageId: id!, id: p.body!.attachmentId! }));
    if (a.data.data) saida.push({ nome: p.filename!, buffer: Buffer.from(a.data.data, "base64url") });
  }
  return saida;
}
