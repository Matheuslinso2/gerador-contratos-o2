// ERP O2 — inadimplência CONFIRMADA pela seguradora (e-mails): Allianz (zip diário com .xls), Pottencial (Prêmios Pendentes .xlsx),
// Alfa e Too (tabela no corpo do e-mail). Grava em erp_parcelas_inadimplencia e liga à parcela do ERP (erp_cruzar_inadimplencia).
// Tokio (cartas por título) e Suhai (aviso por segurado) ficam para uma etapa seguinte.
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { obterClienteGmail, baixarAnexo } from "@/lib/gestaoEmails/gmail";
import type { gmail_v1 } from "@googleapis/gmail";

export type AvisoInadimplencia = {
  seguradora: "ALLI" | "POTT" | "ALFA" | "TOO";
  origem: "email_allianz" | "email_pottencial" | "email_alfa" | "email_too";
  corretora: string | null;
  apolice: string;
  parcela_n: number | null;
  parcela_total: number | null;
  titulo: string | null;
  vencimento: string; // AAAA-MM-DD
  valor: number | null;
  comissao: number | null;
  cliente: string | null;
  cpf_cnpj: string | null;
  previsao_cancelamento: string | null;
  imobiliaria: string | null;
};

const dataBr = (s: string) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const serialExcel = (n: number) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
const dinheiro = (s: unknown) => {
  if (typeof s === "number") return s;
  const t = String(s ?? "").replace(/R\$/g, "").trim();
  if (!t) return null;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : null;
};
const corretoraDe = (t: string | null | undefined) => (/CAPITALIZA|54\.?493\.?758/i.test(t ?? "") ? "O2 Capitalização" : /O2 CORRETORA|20\.?001\.?784/i.test(t ?? "") ? "O2 Corretora" : null);

// Allianz: .xls com cabeçalho "Ramo | Apólice | Item/Adesão | Recibo | Prêmio | Comissão | Data Vencimento | Previsão Cancelamento | Nome | CPF - CNPJ | Sexo | Item | Parcelas"
export function parseAllianz(buf: Buffer): AvisoInadimplencia[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const corretor = String(rows.find((r) => String(r[1] ?? "").trim() === "Corretor")?.[2] ?? "");
  const iCab = rows.findIndex((r) => String(r[2] ?? "").trim() === "Apólice" && String(r[1] ?? "").trim() === "Ramo");
  if (iCab < 0) return [];
  const saida: AvisoInadimplencia[] = [];
  for (const r of rows.slice(iCab + 1)) {
    const apolice = String(r[2] ?? "").trim();
    const venc = dataBr(String(r[7] ?? ""));
    if (!apolice || !venc) continue;
    const p = /(\d+)\s*\/\s*(\d+)/.exec(String(r[13] ?? ""));
    saida.push({
      seguradora: "ALLI", origem: "email_allianz", corretora: corretoraDe(corretor) ?? "O2 Corretora", apolice, parcela_n: p ? Number(p[1]) : null, parcela_total: p ? Number(p[2]) : null,
      titulo: String(r[4] ?? "").trim() || null, vencimento: venc, valor: dinheiro(r[5]), comissao: dinheiro(r[6]), cliente: String(r[9] ?? "").trim() || null,
      cpf_cnpj: String(r[10] ?? "").replace(/\D/g, "") || null, previsao_cancelamento: dataBr(String(r[8] ?? "")), imobiliaria: null,
    });
  }
  return saida;
}

// Pottencial: .xlsx, cabeçalho "Responsável Cobrança | Serasa | Grupo Econômico | Nome cliente | CPF/CNPJ do Cliente | Proposta | Apólice/Endosso | Parcela | Número da Fatura Gerada | ...
//   Corretor Atual | CNPJ do Corretor | Valor Prêmio | Valor Fatura | ... | Vencimento Original | Vencimento Prorrogado | Dias de Atraso | ... | Nome do Estipulante"
export function parsePottencialPendentes(buf: Buffer): AvisoInadimplencia[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  if (!rows.length) return [];
  const cab = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (nome: string) => cab.findIndex((h) => h === nome.toLowerCase());
  const iAp = col("apólice/endosso"), iPar = col("parcela"), iVenc = col("vencimento original");
  if (iAp < 0 || iVenc < 0) return [];
  const iCli = col("nome cliente"), iDoc = col("cpf/cnpj do cliente"), iFat = col("número da fatura gerada"), iVal = col("valor prêmio"), iCorr = col("corretor atual");
  const iCnpj = col("cnpj do corretor"), iEst = col("nome do estipulante");
  const saida: AvisoInadimplencia[] = [];
  for (const r of rows.slice(1)) {
    const apolice = String(r[iAp] ?? "").trim();
    const v = r[iVenc];
    if (!apolice || !v) continue;
    const venc = typeof v === "number" ? serialExcel(v) : dataBr(String(v)) ?? String(v).slice(0, 10);
    saida.push({
      seguradora: "POTT", origem: "email_pottencial", corretora: corretoraDe(`${r[iCorr] ?? ""} ${r[iCnpj] ?? ""}`), apolice, parcela_n: Number(r[iPar]) || null, parcela_total: null,
      titulo: String(r[iFat] ?? "").trim() || null, vencimento: venc, valor: dinheiro(r[iVal]), comissao: null, cliente: String(r[iCli] ?? "").trim() || null,
      cpf_cnpj: String(r[iDoc] ?? "").replace(/\D/g, "") || null, previsao_cancelamento: null, imobiliaria: String(r[iEst] ?? "").trim() || null,
    });
  }
  return saida;
}

// Alfa: HTML com <tr><td>Produto</td><td>Apólice/Endosso</td><td>Parcela</td><td>Vencimento</td><td>Segurado</td><td>Valor</td></tr>
export function parseAlfa(html: string): AvisoInadimplencia[] {
  const corretor = corretoraDe(/Corretor\(a\)\s*<B>(.*?)<\/B>/i.exec(html)?.[1]) ?? "O2 Corretora";
  const saida: AvisoInadimplencia[] = [];
  for (const tr of html.match(/<tr>[\s\S]*?<\/tr>/gi) ?? []) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    if (tds.length < 6 || !/\d{2}\/\d{2}\/\d{4}/.test(tds[3])) continue;
    saida.push({
      seguradora: "ALFA", origem: "email_alfa", corretora: corretor, apolice: tds[1], parcela_n: Number(tds[2]) || null, parcela_total: null, titulo: null,
      vencimento: dataBr(tds[3])!, valor: dinheiro(tds[5]), comissao: null, cliente: tds[4] || null, cpf_cnpj: null, previsao_cancelamento: null, imobiliaria: null,
    });
  }
  return saida;
}

// Too: texto "Corretor Imobiliária Meio de Pagamento Apólice Parcela Vencimento Locatário Valor (R$)", uma linha por parcela:
//   "<corretor> <imobiliária> Fatura Unificada 1074600124118 26 2026-10-13 ERILON DOS SANTOS MENEZES 183.19"
export function parseToo(texto: string): AvisoInadimplencia[] {
  const saida: AvisoInadimplencia[] = [];
  const re = /^(O2 [A-ZÇÃ ]+?(?:LTDA(?: EPP)?|EPP))\s+(.+?)\s+(Fatura Unificada|Boleto|Cart[aã]o[^\d]*?|D[eé]bito[^\d]*?)\s+(\d{8,})\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(.+?)\s+(-?\d+(?:\.\d{2}))$/;
  for (const l of texto.split(/\r?\n/)) {
    const m = re.exec(l.trim());
    if (!m) continue;
    saida.push({
      seguradora: "TOO", origem: "email_too", corretora: corretoraDe(m[1]), apolice: m[4], parcela_n: Number(m[5]), parcela_total: null, titulo: null, vencimento: m[6],
      valor: Number(m[8]), comissao: null, cliente: m[7].trim(), cpf_cnpj: null, previsao_cancelamento: null, imobiliaria: m[2].trim(),
    });
  }
  return saida;
}

// ---- Gmail ----
function decodificar(p: gmail_v1.Schema$MessagePart | undefined, mime: string, acc: string[] = []): string[] {
  if (!p) return acc;
  if (p.mimeType === mime && p.body?.data) acc.push(Buffer.from(p.body.data, "base64url").toString("utf8"));
  for (const f of p.parts ?? []) decodificar(f, mime, acc);
  return acc;
}
function anexosDe(p: gmail_v1.Schema$MessagePart | undefined, acc: { nome: string; id: string }[] = []) {
  if (!p) return acc;
  if (p.filename && p.body?.attachmentId) acc.push({ nome: p.filename, id: p.body.attachmentId });
  for (const f of p.parts ?? []) anexosDe(f, acc);
  return acc;
}

const FONTES = [
  { seguradora: "ALLI" as const, query: (d: string) => `subject:("Allianz Conectividade" Inadimplencia) after:${d}` },
  { seguradora: "POTT" as const, query: (d: string) => `from:cobranca@pottencial.com.br has:attachment after:${d}` },
  { seguradora: "ALFA" as const, query: (d: string) => `from:financeiro@alfaseg.com.br subject:"Parcelas Pendentes" after:${d}` },
  { seguradora: "TOO" as const, query: (d: string) => `subject:"Comunicado de Parcelas em Atraso" after:${d}` },
];

export type ResumoInadimplencia = { seguradora: string; emails: number; avisos: number; gravados: number; erros: string[] };

export async function carregarInadimplenciaSeguradoras(
  sb: SupabaseClient,
  opts: { desde: string; gravar: boolean; apenas?: string[] },
): Promise<ResumoInadimplencia[]> {
  const api = obterClienteGmail();
  const { data: segs } = await sb.from("erp_seguradoras").select("id, abreviacao").in("abreviacao", ["ALLI", "POTT", "ALFA", "TOO"]);
  const segId = new Map((segs ?? []).map((s: { id: string; abreviacao: string }) => [s.abreviacao, s.id]));
  const desde = opts.desde.replace(/-/g, "/");
  const saida: ResumoInadimplencia[] = [];
  for (const f of FONTES) {
    if (opts.apenas?.length && !opts.apenas.includes(f.seguradora)) continue;
    const r: ResumoInadimplencia = { seguradora: f.seguradora, emails: 0, avisos: 0, gravados: 0, erros: [] };
    saida.push(r);
    try {
      const lista = await api.users.messages.list({ userId: "me", q: f.query(desde), maxResults: 100 });
      const ids = (lista.data.messages ?? []).map((m) => m.id).filter((x): x is string => !!x);
      r.emails = ids.length;
      const todos: (AvisoInadimplencia & { comunicado: string })[] = [];
      for (const id of ids) {
        try {
          const msg = (await api.users.messages.get({ userId: "me", id, format: "full" })).data;
          const data = new Date(Number(msg.internalDate ?? Date.now())).toISOString().slice(0, 10);
          let avisos: AvisoInadimplencia[] = [];
          if (f.seguradora === "ALLI") {
            for (const a of anexosDe(msg.payload).filter((x) => /\.zip$/i.test(x.nome))) {
              const zip = await JSZip.loadAsync(await baixarAnexo(id, a.id));
              for (const nome of Object.keys(zip.files).filter((n) => /\.xlsx?$/i.test(n))) avisos.push(...parseAllianz(Buffer.from(await zip.files[nome].async("uint8array"))));
            }
          } else if (f.seguradora === "POTT") {
            for (const a of anexosDe(msg.payload).filter((x) => /\.xlsx?$/i.test(x.nome))) avisos.push(...parsePottencialPendentes(await baixarAnexo(id, a.id)));
          } else if (f.seguradora === "ALFA") {
            avisos = parseAlfa(decodificar(msg.payload, "text/html").join("\n"));
          } else {
            avisos = parseToo(decodificar(msg.payload, "text/plain").join("\n"));
          }
          for (const a of avisos) todos.push({ ...a, comunicado: data });
        } catch (e) {
          r.erros.push(`${id}: ${(e as Error).message}`);
        }
      }
      r.avisos = todos.length;
      if (!opts.gravar || !todos.length) continue;
      // mesma parcela em vários dias (Allianz repete o relatório): fica uma linha, com a 1ª data do comunicado e a última vez vista
      const porChave = new Map<string, (typeof todos)[number] & { ultima: string }>();
      for (const a of todos.sort((x, y) => x.comunicado.localeCompare(y.comunicado))) {
        const k = [a.apolice, a.parcela_n ?? 0, a.titulo ?? "", a.vencimento].join("|");
        const ant = porChave.get(k);
        porChave.set(k, ant ? { ...a, comunicado: ant.comunicado, ultima: a.comunicado } : { ...a, ultima: a.comunicado });
      }
      const linhas = [...porChave.values()].map((a) => ({
        seguradora_id: segId.get(a.seguradora), numero_apolice: a.apolice, parcela_n: a.parcela_n ?? 0, parcela_total: a.parcela_total, titulo: a.titulo ?? "",
        data_comunicado: a.comunicado, ultima_vez_visto: a.ultima, vencimento_original: a.vencimento, valor: a.valor, comissao: a.comissao, origem: a.origem,
        corretora: a.corretora, cliente: a.cliente, cpf_cnpj: a.cpf_cnpj, previsao_cancelamento: a.previsao_cancelamento,
      }));
      for (let i = 0; i < linhas.length; i += 200) {
        const { error } = await sb.from("erp_parcelas_inadimplencia").upsert(linhas.slice(i, i + 200), {
          onConflict: "seguradora_id,numero_apolice,parcela_n,titulo,vencimento_original", ignoreDuplicates: false,
        });
        if (error) r.erros.push(`gravar: ${error.message}`);
        else r.gravados += Math.min(200, linhas.length - i);
      }
    } catch (e) {
      r.erros.push((e as Error).message);
    }
  }
  if (opts.gravar) {
    const { error } = await sb.rpc("erp_cruzar_inadimplencia");
    if (error) saida.push({ seguradora: "cruzamento", emails: 0, avisos: 0, gravados: 0, erros: [error.message] });
  }
  return saida;
}
