// Enriquece o cadastro de clientes (locatarios) com e-mail e telefone lidos dos PDFs já guardados em erp_documento_anexos
// (apólice/proposta/cotação ligados ao documento). SÓ preenche campo vazio, e só quando o dado está colado ao CPF/CNPJ da
// própria pessoa no texto do PDF (janela de ±250 caracteres) e é único nessa janela. Ensaio por padrão. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/enriquecer-clientes-pdf.ts [--gravar] [--saida arquivo.json]
// O arquivo de saída (com dados pessoais) vai para fora do projeto (pasta temporária).
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf, dig } from "@/lib/erp/anexosEmail";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const SAIDA = arg("saida") ?? path.join(os.tmpdir(), "enriquecer-clientes-pdf.json");
const sb = createServiceClient();

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const FONE = /(?:\+?55\s?)?\(?\b(\d{2})\)?[\s.-]?(9?\d{4})[\s.-]?(\d{4})\b/g;
const IGNORAR_EMAIL = /(o2seguros|tokiomarine|portoseguro|pottencial|alfaseg|yelum|liberty|suhai|tooseguros|sompo|hdi\.|brasilcap|mapfre|sulamerica|bradesco|susep|noreply|no-reply|naoresponda)/i;
const DDD_VALIDO = (d: string) => Number(d) >= 11 && Number(d) <= 99 && !/0/.test(d[0]);

/** Regex que acha o CPF/CNPJ com ou sem pontuação. */
const regexDoc = (d: string) => new RegExp(d.split("").join("[.\\-/\\s]?"), "g");

const LIVRES = /^(gmail|hotmail|outlook|yahoo|icloud|live|uol|bol|terra|ig|msn|globo|oi|me|protonmail)./i;
/** E-mails e domínios corporativos das imobiliárias: nunca são do cliente. */
async function bloqueadosDeImobiliarias(): Promise<{ emails: Set<string>; dominios: Set<string> }> {
  const emails = new Set<string>(), dominios = new Set<string>();
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("imobiliarias").select("email,email_faturas,email_repasses,email_campanhas").order("id").range(de, de + 999);
    for (const i of data ?? []) for (const v of [i.email, i.email_faturas, i.email_repasses, i.email_campanhas]) for (const e of ((Array.isArray(v) ? v.join(" ") : v ?? "").match(EMAIL) ?? [])) {
      const m = e.toLowerCase(); emails.add(m); const dom = m.split("@")[1]; if (!LIVRES.test(dom)) dominios.add(dom);
    }
    if ((data ?? []).length < 1000) break;
  }
  return { emails, dominios };
}

type Cli = { id: string; nome: string; cpf: string; email: string | null; telefone: string | null };

(async () => {
  const bloq = await bloqueadosDeImobiliarias();
  const deImobiliaria = (e: string) => bloq.emails.has(e) || bloq.dominios.has(e.split("@")[1]);
  const { data: anexos } = await sb.from("erp_documento_anexos").select("id,documento_id,storage_path,nome_arquivo,tipo,situacao").eq("origem", "email").eq("situacao", "confirmada").not("storage_path", "is", null);
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${anexos?.length ?? 0} anexos confirmados`);
  const porDoc = new Map<string, Cli[]>();
  const clientesDoDoc = async (docId: string): Promise<Cli[]> => {
    if (porDoc.has(docId)) return porDoc.get(docId)!;
    const { data: d } = await sb.from("erp_documentos").select("locatario_id").eq("id", docId).maybeSingle();
    const { data: p } = await sb.from("erp_doc_partes_acervo").select("locatario_id").eq("documento_id", docId);
    const ids = [...new Set([d?.locatario_id, ...(p ?? []).map((x) => x.locatario_id)].filter((x): x is string => !!x))];
    const { data: ls } = ids.length ? await sb.from("locatarios").select("id,nome,cpf,email,telefone").in("id", ids) : { data: [] };
    const lista = (ls ?? []).map((l) => ({ id: l.id, nome: l.nome, cpf: dig(l.cpf), email: (l.email ?? "").trim() || null, telefone: (l.telefone ?? "").trim() || null })).filter((c) => c.cpf.length >= 11);
    porDoc.set(docId, lista);
    return lista;
  };

  const propostas = new Map<string, { id: string; nome: string; email?: string; telefone?: string; de: string[] }>();
  const r = { anexos: 0, semTexto: 0, clientesNoPdf: 0, clientesComLacuna: 0, emailAchado: 0, telefoneAchado: 0, emailAmbiguo: 0, telefoneAmbiguo: 0 };
  for (const a of anexos ?? []) {
    const clientes = await clientesDoDoc(a.documento_id);
    if (!clientes.length) continue;
    const { data: arq } = await sb.storage.from("anexos-documentos").download(a.storage_path!);
    if (!arq) continue;
    r.anexos++;
    const { t } = await textoDoPdf(Buffer.from(await arq.arrayBuffer()), clientes.map((c) => c.cpf));
    if (!t) { r.semTexto++; continue; }
    for (const c of clientes) {
      const ocorrencias = [...t.matchAll(regexDoc(c.cpf))];
      if (!ocorrencias.length) continue;
      r.clientesNoPdf++;
      if (c.email && c.telefone) continue;
      r.clientesComLacuna++;
      const emails = new Set<string>(), fones = new Set<string>();
      for (const o of ocorrencias) {
        const janela = t.slice(Math.max(0, o.index! - 250), o.index! + c.cpf.length + 250);
        for (const m of janela.match(EMAIL) ?? []) if (!IGNORAR_EMAIL.test(m) && !deImobiliaria(m.toLowerCase())) emails.add(m.toLowerCase());
        for (const m of janela.matchAll(FONE)) if (DDD_VALIDO(m[1]) && dig(janela.slice(Math.max(0, m.index! - 1), m.index! + 1)) === "") fones.add(`(${m[1]}) ${m[2]}-${m[3]}`);
      }
      const p = propostas.get(c.id) ?? propostas.set(c.id, { id: c.id, nome: c.nome, de: [] }).get(c.id)!;
      if (!c.email) { if (emails.size === 1) { p.email ??= [...emails][0]; p.de.push(a.nome_arquivo ?? a.tipo); } else if (emails.size > 1) r.emailAmbiguo++; }
      if (!c.telefone) { if (fones.size === 1) { p.telefone ??= [...fones][0]; p.de.push(a.nome_arquivo ?? a.tipo); } else if (fones.size > 1) r.telefoneAmbiguo++; }
    }
  }
  const lista = [...propostas.values()].filter((p) => p.email || p.telefone);
  r.emailAchado = lista.filter((p) => p.email).length;
  r.telefoneAchado = lista.filter((p) => p.telefone).length;
  fs.writeFileSync(SAIDA, JSON.stringify(lista, null, 1));
  console.log(JSON.stringify(r), `| clientes com algo a preencher: ${lista.length} | arquivo: ${SAIDA}`);
  console.log(lista.slice(0, 6).map((p) => `${p.nome.split(" ")[0]} …  e-mail:${p.email ? p.email.replace(/^(.{2}).*(@.*)$/, "$1***$2") : "-"}  tel:${p.telefone ? p.telefone.replace(/\d{4}$/, "****") : "-"}`).join("\n"));

  if (GRAVAR) {
    let ok = 0;
    for (const p of lista) {
      const campos: Record<string, string> = {};
      if (p.email) campos.email = p.email;
      if (p.telefone) campos.telefone = p.telefone;
      // só preenche se continuar vazio (nunca sobrescreve)
      for (const [col, val] of Object.entries(campos)) {
        const { error, count } = await sb.from("locatarios").update({ [col]: val }, { count: "exact" }).eq("id", p.id).or(`${col}.is.null,${col}.eq.`);
        if (!error && count) ok++;
      }
    }
    console.log(`gravados ${ok} campos`);
  }
})();
