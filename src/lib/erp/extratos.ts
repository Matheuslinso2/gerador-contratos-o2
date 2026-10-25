// ERP O2 — Fase 2 (25/10/2026): extratos/demonstrativos de comissão das seguradoras.
// Chegam por e-mail (caixa do Matheus, via conta de serviço do /gestao-emails):
//   • Pottencial — "Dem Com. Nº: <n>" mensal, anexo XLS com 1 linha por apólice × parcela (2 corretoras O2).
//   • Too — "Demonstrativo de Comissão - Too Seguros" semanal, XLS com 1 linha por apólice × parcela.
//   • Tokio — "Valores para Emissão da Nota Fiscal" mensal: SÓ o total do mês (detalhe fica no portal).
//   • Porto / Yelum — nada por e-mail (extrato só no portal). Allianz manda "Comissões Pagas" diário (ainda não lido).
// Cada anexo vira 1 linha em erp_extratos_seguradora (linhas brutas em jsonb) + N linhas em
// erp_extrato_linhas (normalizadas e casadas com erp_documentos / erp_parcelas por SQL).
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { listarMensagensComAnexos, baixarAnexo } from "@/lib/gestaoEmails/gmail";

export type LinhaExtrato = {
  n: number;
  apolice: string | null;
  proposta: string | null;
  endosso: string | null;
  parcela: number | null;
  cliente: string | null;
  cpf_cnpj: string | null;
  premio: number | null;
  pct_comissao: number | null;
  valor_comissao: number | null;
  vigencia_inicio: string | null;
  produto: string | null;
  tipo: string | null;
};

export type Fonte = {
  seguradora: "POTTENCIAL" | "TOO" | "TOKIO";
  abreviacao: "POTT" | "TOO" | "TOKI";
  query: (desde: string) => string;
  anexoAceito: (nome: string) => boolean;
  tipo: "detalhado" | "resumo";
};

export const FONTES: Fonte[] = [
  {
    seguradora: "POTTENCIAL",
    abreviacao: "POTT",
    query: (desde) => `from:operacional@pottencial.com.br subject:"Dem Com" after:${desde.replace(/-/g, "/")}`,
    anexoAceito: (n) => /^Demonstrativo_Comissoes_.*\.xlsx?$/i.test(n),
    tipo: "detalhado",
  },
  {
    seguradora: "TOO",
    abreviacao: "TOO",
    query: (desde) => `subject:"Demonstrativo de Comissão - Too Seguros" after:${desde.replace(/-/g, "/")}`,
    anexoAceito: (n) => /^Demonstrativo_.*\.xlsx?$/i.test(n),
    tipo: "detalhado",
  },
  {
    seguradora: "TOKIO",
    abreviacao: "TOKI",
    query: (desde) => `from:emissao.nfse@tokiomarine.com.br subject:"Valores para Emissão da Nota Fiscal" after:${desde.replace(/-/g, "/")}`,
    anexoAceito: () => false,
    tipo: "resumo",
  },
];

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/ /g, " ").trim();
  return s ? s : null;
};
const dataBr = (v: unknown): string | null => {
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

function linhasDaPlanilha(buf: Buffer): unknown[][] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
}

// Pottencial: cabeçalho "Tipo | Proposta | Cliente | CNPJ | Apólice ou Endosso | Apólice | Ramo | Parcela | Vlr. Premio | % Com | % Participacao | Vlr. Comissao | Tipo Comissao"
export function parsePottencial(buf: Buffer): { linhas: LinhaExtrato[]; total_bruto: number | null; total_liquido: number | null; demonstrativo: string | null } {
  const rows = linhasDaPlanilha(buf);
  let total_bruto: number | null = null, total_liquido: number | null = null, demonstrativo: string | null = null;
  const linhas: LinhaExtrato[] = [];
  let emTabela = false;
  for (const r of rows) {
    const c0 = txt(r[0]);
    if (c0 === "CNPJ" || c0 === "CNPJ ") { total_bruto = num(r[4]); total_liquido = num(r[10]); continue; }
    if (c0 === "Demonstrativo") { demonstrativo = txt(r[2]); continue; }
    if (c0 === "Tipo" && txt(r[1]) === "Proposta") { emTabela = true; continue; }
    if (!emTabela || !c0) continue;
    linhas.push({
      n: linhas.length + 1,
      tipo: c0,
      proposta: txt(r[1]),
      cliente: txt(r[2]),
      cpf_cnpj: txt(r[3])?.replace(/\D/g, "") ?? null,
      endosso: txt(r[4]) !== txt(r[5]) ? txt(r[4]) : null,
      apolice: txt(r[5]),
      produto: txt(r[6]),
      parcela: num(r[7]),
      premio: num(r[8]),
      pct_comissao: num(r[9]),
      valor_comissao: num(r[11]),
      vigencia_inicio: null,
    });
  }
  return { linhas, total_bruto, total_liquido, demonstrativo };
}

// Too: cabeçalho "Tipo de comissão | CNPJ Origem | N° apólice | Endosso | Cancelamento | Produto | N° parcela | Início vigência | Fim vigência | Tomador | Corretor | Subestipulante | Valor Total Parcela | Prêmio tarifário | % Comissão | id_lancamento | Valor da comissão | N° bilhete | Ramo | CNPJ/CPF | ..."
export function parseToo(buf: Buffer): { linhas: LinhaExtrato[]; total_bruto: number | null; total_liquido: number | null } {
  const rows = linhasDaPlanilha(buf);
  let total_bruto: number | null = null, total_liquido: number | null = null;
  const linhas: LinhaExtrato[] = [];
  let emTabela = false;
  for (const r of rows) {
    const c0 = txt(r[0]);
    if (c0 === "Valor total bruto") { total_bruto = num(r[1]); continue; }
    if (c0 === "Valor total liquido") { total_liquido = num(r[1]); continue; }
    if (c0?.startsWith("Tipo de comiss")) { emTabela = true; continue; }
    if (!emTabela || !c0 || !txt(r[2])) continue;
    linhas.push({
      n: linhas.length + 1,
      tipo: c0,
      apolice: txt(r[2]),
      endosso: num(r[3]) ? txt(r[3]) : null,
      proposta: null,
      produto: txt(r[5]),
      parcela: num(r[6]),
      vigencia_inicio: dataBr(r[7]),
      cliente: txt(r[9]),
      premio: num(r[13]),
      pct_comissao: num(r[14]),
      valor_comissao: num(r[16]),
      cpf_cnpj: txt(r[19])?.replace(/\D/g, "") ?? null,
    });
  }
  return { linhas, total_bruto, total_liquido };
}

// Tokio: só o resumo no corpo — "08/2026 070145 Comissão 38.439,97 768,80 0,00 ..."
export function parseTokioResumo(corpo: string): { competencia: string | null; total_bruto: number | null; iss: number | null } {
  const m = corpo.match(/(\d{2})\/(\d{4})\s+(\d+)\s+Comiss[ãa]o\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})/);
  if (!m) return { competencia: null, total_bruto: null, iss: null };
  return { competencia: `${m[2]}-${m[1]}-01`, total_bruto: num(m[4]), iss: num(m[5]) };
}

export type ResumoCarga = {
  seguradora: string;
  mensagens: number;
  extratos_novos: number;
  extratos_ja_carregados: number;
  linhas: number;
  erros: string[];
};

export async function carregarExtratos(
  sb: SupabaseClient,
  opts: { desde: string; gravar: boolean; apenas?: string[]; max?: number }
): Promise<ResumoCarga[]> {
  const saida: ResumoCarga[] = [];
  const { data: segs } = await sb.from("erp_seguradoras").select("id, abreviacao").in("abreviacao", ["POTT", "TOO", "TOKI"]);
  const segId = new Map((segs ?? []).map((s: { id: string; abreviacao: string }) => [s.abreviacao, s.id]));
  const { data: corrs } = await sb.from("erp_corretoras").select("id, apelido");
  const corrId = (apelido: string) => (corrs ?? []).find((c: { id: string; apelido: string }) => c.apelido === apelido)?.id ?? null;
  // corretora pelo assunto/corpo do e-mail: CNPJ 54.493.758 ou "O2 CAPITALIZACAO" = O2 Capitalização; 20.001.784 ou "O2 CORRETORA" = O2 Corretora
  const corretoraDe = (texto: string) => /54.?493.?758|O2 CAPITALIZA/i.test(texto) ? corrId("O2 Capitalização") : /20.?001.?784|O2 CORRETORA/i.test(texto) ? corrId("O2 Corretora") : null;
  for (const fonte of FONTES) {
    if (opts.apenas?.length && !opts.apenas.includes(fonte.seguradora)) continue;
    const resumo: ResumoCarga = { seguradora: fonte.seguradora, mensagens: 0, extratos_novos: 0, extratos_ja_carregados: 0, linhas: 0, erros: [] };
    saida.push(resumo);
    let msgs: Awaited<ReturnType<typeof listarMensagensComAnexos>>;
    try {
      msgs = await listarMensagensComAnexos(fonte.query(opts.desde), opts.max ?? 40);
    } catch (e) {
      resumo.erros.push(`gmail: ${(e as Error).message}`);
      continue;
    }
    resumo.mensagens = msgs.length;
    const { data: jaCarregados } = await sb.from("erp_extratos_seguradora").select("gmail_message_id, arquivo_path").eq("seguradora_id", segId.get(fonte.abreviacao) ?? "");
    // chave = mensagem (resumos sem anexo) ou nome do arquivo (e-mails encaminhados "Fwd:" repetem o mesmo anexo)
    const chaves = new Set((jaCarregados ?? []).map((x: { gmail_message_id: string; arquivo_path: string | null }) => (x.arquivo_path ? `arq|${x.arquivo_path}` : `msg|${x.gmail_message_id}`)));
    for (const m of msgs) {
      try {
        if (fonte.tipo === "resumo") {
          if (chaves.has(`msg|${m.id}`)) { resumo.extratos_ja_carregados++; continue; }
          const r = parseTokioResumo(m.corpoTexto);
          if (!r.total_bruto) { resumo.erros.push(`${m.assunto}: resumo não reconhecido`); continue; }
          resumo.extratos_novos++;
          if (!opts.gravar) continue;
          const { error } = await sb.from("erp_extratos_seguradora").insert({
            seguradora_id: segId.get(fonte.abreviacao), corretora_id: corretoraDe(m.assunto + " " + m.corpoTexto.slice(0, 400)), competencia: r.competencia, tipo: "resumo_mensal", origem: "gmail",
            gmail_message_id: m.id, arquivo_path: null, linhas: [], total_bruto: r.total_bruto, total_liquido: r.total_bruto !== null && r.iss !== null ? r.total_bruto - r.iss : null,
            observacao: `${m.assunto} — só o total do mês; detalhe por apólice fica no Portal Parceiros (Eu, Corretor > Tributos).`,
          });
          if (error) throw new Error(error.message);
          continue;
        }
        for (const a of m.anexos.filter((x) => fonte.anexoAceito(x.nome))) {
          if (chaves.has(`arq|${a.nome}`)) { resumo.extratos_ja_carregados++; continue; }
          chaves.add(`arq|${a.nome}`);
          const buf = await baixarAnexo(m.id, a.attachmentId);
          const parsed = fonte.seguradora === "POTTENCIAL" ? parsePottencial(buf) : parseToo(buf);
          if (!parsed.linhas.length) { resumo.erros.push(`${a.nome}: nenhuma linha reconhecida`); continue; }
          resumo.extratos_novos++;
          resumo.linhas += parsed.linhas.length;
          if (!opts.gravar) continue;
          const dataMsg = new Date(m.data);
          const competencia = Number.isNaN(dataMsg.getTime()) ? null : `${dataMsg.getFullYear()}-${String(dataMsg.getMonth() + 1).padStart(2, "0")}-01`;
          const { data: ext, error } = await sb
            .from("erp_extratos_seguradora")
            .insert({
              seguradora_id: segId.get(fonte.abreviacao), corretora_id: corretoraDe(m.assunto), competencia, tipo: "demonstrativo", origem: "gmail",
              gmail_message_id: m.id, arquivo_path: a.nome, linhas: parsed.linhas, total_bruto: parsed.total_bruto, total_liquido: parsed.total_liquido,
              observacao: `${m.assunto} (${m.data.slice(0, 25)})${"demonstrativo" in parsed && parsed.demonstrativo ? ` · demonstrativo ${parsed.demonstrativo}` : ""}`,
            })
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          const { error: e2 } = await sb.from("erp_extrato_linhas").insert(
            parsed.linhas.map((l) => ({ extrato_id: ext.id, seguradora: fonte.seguradora, ...l }))
          );
          if (e2) throw new Error(e2.message);
        }
      } catch (e) {
        resumo.erros.push(`${m.assunto.slice(0, 60)}: ${(e as Error).message}`);
      }
    }
  }
  return saida;
}
