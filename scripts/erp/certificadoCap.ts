// Certificados de Capitalização (Brasilcap "Cap Fiador" e afins): leitura do PDF e ligação ao documento VIGENTE de Capitalização do ERP.
// Regra do Matheus: a vigência é o modo de reaplicação (12, 15 ou 30 meses) contado do início; reaplicar = renovação.
// Ligação: número da garantia/certificado (= "Nº da apólice" do documento) + data de início OU CPF/CNPJ de uma parte = 'confirmada'; só o número = 'provavel'.
// Só leitura; nada é gravado.
import type { SupabaseClient } from "@supabase/supabase-js";
import { carregarDocs, documentosNoTexto, type DocAlvo } from "@/lib/erp/anexosEmail";

export type CertificadoLido = {
  numero: string | null; // número da garantia (Brasilcap)
  valor: number | null;
  produto: string | null; // ex.: "Cap Fiador 15 D"
  meses: number | null; // modo de reaplicação lido no produto
  inicio: string | null; // aaaa-mm-dd
  fim: string | null; // início + meses
  cpfs: Set<string>;
  numerosCandidatos: Set<string>; // qualquer sequência de 4–12 dígitos (para outras seguradoras)
};
export type CapVigente = { id: string; nosso_numero: number; numero_apolice: string | null; seguradora_id: string | null; vigencia_inicio: string | null; vigencia_fim: string | null };

const sd = (s: string) => s.replace(/^0+/, "");
export const somaMeses = (iso: string, m: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };
const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : null);

export function ehCertificado(tt: string): boolean {
  return /CERTIFICADO|T[ÍI]TULO DE CAPITALIZA|GARANTIA|CAPITALIZA/i.test(tt);
}

export function lerCertificado(texto: string): CertificadoLido {
  const tt = texto.replace(/\s+/g, " ");
  const br2iso = (d: string) => d.split("/").reverse().join("-");
  const inicioBr = /(\d{2}\/\d{2}\/\d{4})\s*IN[ÍI]CIO DE VIG[ÊE]NCIA/i.exec(tt)?.[1] ?? null;
  // Icatu: "Título número 01.609.754-9", "Prazo de Capitalização 12 meses", "vigência De dd/mm/aaaa Até dd/mm/aaaa" ou "Início de Vigência: dd/mm/aaaa"
  const icatuNum = /T[ÍI]TULO\s+N[ÚU]MERO\s*([\d.\-]{6,14})/i.exec(tt)?.[1]?.replace(/\D/g, "") ?? null;
  const icatuVig = /vig[êe]ncia\s*De\s*(\d{2}\/\d{2}\/\d{4})\s*At[ée]\s*(\d{2}\/\d{2}\/\d{4})/i.exec(tt);
  const icatuIni = /In[ií]cio de Vig[êe]ncia:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(tt)?.[1] ?? null;
  const icatuMeses = Number(/Prazo de Capitaliza[çc][ãa]o:?\s*(\d{1,2})\s*meses/i.exec(tt)?.[1] ?? NaN) || null;
  const inicio = inicioBr ? br2iso(inicioBr) : icatuVig ? br2iso(icatuVig[1]) : icatuIni ? br2iso(icatuIni) : null;
  const produto = /DADOS DO T[ÍI]TULO\s*(.+?)\s*PRODUTO/i.exec(tt)?.[1]?.trim() ?? null;
  const meses =
    Number(/Cap\s+Fiador\s+(\d{1,2})/i.exec(produto ?? tt)?.[1] ?? NaN) ||
    icatuMeses ||
    (icatuVig ? Math.round((Date.parse(br2iso(icatuVig[2])) - Date.parse(br2iso(icatuVig[1]))) / 864e5 / 30.44) : null);
  const valorTxt = /R\$\s*([\d.,]+)\s*VALOR DA GARANTIA/i.exec(tt)?.[1];
  // o valor vem em formato americano ("80,000.00")
  const valor = valorTxt ? Number(valorTxt.replace(/,/g, "")) : null;
  return {
    numero: /(\d{3,9})\s*N[ÚU]MERO DA GARANTIA/i.exec(tt)?.[1] ?? icatuNum,
    valor: Number.isFinite(valor as number) ? valor : null,
    produto, meses, inicio, fim: icatuVig ? br2iso(icatuVig[2]) : inicio && meses ? somaMeses(inicio, meses) : null,
    cpfs: documentosNoTexto(tt),
    numerosCandidatos: new Set([...tt.matchAll(/\b\d{4,12}\b/g)].map((x) => sd(x[0]))),
  };
}

export type IndiceCap = { vigentes: CapVigente[]; porNumero: Map<string, CapVigente[]>; docsCpf: Map<string, DocAlvo>; nomeSeguradora: Map<string, string> };

export async function carregarCapVigentes(sb: SupabaseClient, comCpf = true, codigosO2?: number[]): Promise<IndiceCap> {
  const { data: ramos } = await sb.from("erp_ramos").select("id,nome");
  const idsRamo = (ramos ?? []).filter((r) => /capitaliza/i.test(r.nome)).map((r) => r.id);
  const { data: segs } = await sb.from("erp_seguradoras").select("id,nome");
  const vigentes: CapVigente[] = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.from("erp_documentos").select("id,nosso_numero,numero_apolice,seguradora_id,vigencia_inicio,vigencia_fim").in("ramo_id", idsRamo);
    q = codigosO2 ? q.in("nosso_numero", codigosO2) : q.eq("situacao", "vigente"); // codigosO2: documentos específicos (ex.: anteriores vencidos), qualquer situação
    const { data } = await q.order("id").range(de, de + 999);
    vigentes.push(...((data ?? []) as CapVigente[]));
    if ((data ?? []).length < 1000 || codigosO2) break;
  }
  const porNumero = new Map<string, CapVigente[]>();
  for (const d of vigentes) { const n = sd(String(d.numero_apolice ?? "").replace(/\D/g, "")); if (n.length >= 4) (porNumero.get(n) ?? porNumero.set(n, []).get(n)!).push(d); }
  return { vigentes, porNumero, docsCpf: comCpf ? await carregarDocs(sb, vigentes.map((d) => d.id)) : new Map(), nomeSeguradora: new Map((segs ?? []).map((s) => [s.id, s.nome])) };
}

export type LigacaoCert = { doc: CapVigente; situacao: "confirmada" | "provavel"; porData: boolean; porCpf: boolean; fimConfere: boolean | null; via?: "numero" | "cpf+inicio" };

/** Documentos vigentes de Capitalização que o certificado comprova. */
export function ligarCertificado(ind: IndiceCap, tt: string, c: CertificadoLido): LigacaoCert[] {
  const saida: LigacaoCert[] = [];
  const numeros = c.numero ? new Set([sd(c.numero)]) : c.numerosCandidatos;
  for (const n of numeros) for (const d of ind.porNumero.get(n) ?? []) {
    const porData = !!d.vigencia_inicio && (tt.includes(dmy(d.vigencia_inicio)!) || (!!c.inicio && Math.abs(Date.parse(c.inicio) - Date.parse(d.vigencia_inicio)) <= 864e5));
    const porCpf = (ind.docsCpf.get(d.id)?.cpfs ?? []).some((x) => c.cpfs.has(x));
    const fimConfere = c.fim && d.vigencia_fim ? Math.abs(Date.parse(c.fim) - Date.parse(d.vigencia_fim)) <= 864e5 : null;
    saida.push({ doc: d, situacao: porData || porCpf ? "confirmada" : "provavel", porData, porCpf, fimConfere, via: "numero" });
  }
  // sem número que case: CPF/CNPJ de uma parte do documento + início de vigência (±3 dias) = confirmada
  if (!saida.length && c.inicio) {
    for (const d of ind.vigentes) {
      if (!d.vigencia_inicio || Math.abs(Date.parse(c.inicio) - Date.parse(d.vigencia_inicio)) > 3 * 864e5) continue;
      if (!(ind.docsCpf.get(d.id)?.cpfs ?? []).some((x) => c.cpfs.has(x))) continue;
      saida.push({
        doc: d, situacao: "confirmada", porData: true, porCpf: true, via: "cpf+inicio",
        fimConfere: c.fim && d.vigencia_fim ? Math.abs(Date.parse(c.fim) - Date.parse(d.vigencia_fim)) <= 864e5 : null,
      });
    }
  }
  return saida;
}
