import * as XLSX from "xlsx";

// Leitura da planilha de lote de renovação devolvida pela equipe (anexo do card do funil Renovações). Cada linha = um documento com a sua
// negociação individual: decisão (renova / não renova), parcelamento, prêmio e comissão (Matheus 29/10). Os cabeçalhos são achados pelo NOME
// (tolerante a acento, maiúsculas e variações); o que não for reconhecido vai em `extras`, nunca se perde.

export type LinhaNegociacao = {
  linha: number;
  apolice: string;
  fim_vigencia: string | null;
  decisao: "renova" | "nao_renova" | null;
  parcelas: number | null;
  premio_total: number | null;
  comissao_pct: number | null;
  comissao_valor: number | null;
  extras: Record<string, string | number>;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const texto = (v: unknown) => String(v ?? "").trim();
function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = texto(v).replace(/[R$\s%]/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}
function dataIso(v: unknown): string | null {
  if (typeof v === "number" && v > 20000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(texto(v));
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const i = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(v));
  return i ? `${i[1]}-${i[2]}-${i[3]}` : null;
}
export function decisaoDe(v: unknown): "renova" | "nao_renova" | null {
  const t = semAcento(texto(v));
  if (!t) return null;
  if (/^(NAO|N)\b|NAO RENOV|CANCEL|PERD|DESIST/.test(t)) return "nao_renova";
  if (/^(SIM|S|RENOV|OK|FECHAD|EFETIV)/.test(t)) return "renova";
  return null;
}

// reconhecimento dos cabeçalhos (primeira coluna que casar vence)
const COLUNAS: [keyof Omit<LinhaNegociacao, "linha" | "extras">, RegExp][] = [
  ["apolice", /^APOLICE$/],
  ["fim_vigencia", /FIM DE VIGENCIA/],
  ["decisao", /^(RENOVA|RENOVA\?|RENOVA \/ NAO RENOVA|RENOVACAO|DECISAO)$/],
  ["parcelas", /^PARCELAS \(X\)$/],
  ["premio_total", /^(VALOR 2026|PREMIO( TOTAL)?( 2026)?)$/],
  ["comissao_pct", /^(% ?COMISSAO|COMISSAO %)$/],
  ["comissao_valor", /^(COMISSAO|COMISSAO R\$|VALOR COMISSAO)$/],
];

/** Lê a primeira aba que tenha a coluna APÓLICE. Devolve as linhas com apólice e quais colunas foram reconhecidas. */
export function lerPlanilhaNegociacao(arquivo: Buffer): { linhas: LinhaNegociacao[]; reconhecidas: string[]; ausentes: string[] } | null {
  const wb = XLSX.read(arquivo);
  for (const nome of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nome], { defval: "" });
    if (!rows.length) continue;
    const cab = Object.keys(rows[0]);
    const mapa = new Map<string, string>();
    for (const [campo, re] of COLUNAS) {
      const c = cab.find((h) => re.test(semAcento(h)) && ![...mapa.values()].includes(h));
      if (c) mapa.set(campo, c);
    }
    if (!mapa.has("apolice")) continue;
    const usadas = new Set(mapa.values());
    const linhas: LinhaNegociacao[] = [];
    rows.forEach((r, i) => {
      const apolice = texto(r[mapa.get("apolice")!]);
      if (!apolice) return;
      const extras: Record<string, string | number> = {};
      for (const h of cab) {
        if (usadas.has(h)) continue;
        const v = r[h];
        if (v !== "" && v !== null && v !== undefined) extras[h] = typeof v === "number" ? v : texto(v);
      }
      linhas.push({
        linha: i + 2,
        apolice,
        fim_vigencia: mapa.has("fim_vigencia") ? dataIso(r[mapa.get("fim_vigencia")!]) : null,
        decisao: mapa.has("decisao") ? decisaoDe(r[mapa.get("decisao")!]) : null,
        parcelas: mapa.has("parcelas") ? numero(r[mapa.get("parcelas")!]) : null,
        premio_total: mapa.has("premio_total") ? numero(r[mapa.get("premio_total")!]) : null,
        comissao_pct: mapa.has("comissao_pct") ? numero(r[mapa.get("comissao_pct")!]) : null,
        comissao_valor: mapa.has("comissao_valor") ? numero(r[mapa.get("comissao_valor")!]) : null,
        extras,
      });
    });
    return { linhas, reconhecidas: [...mapa.keys()], ausentes: COLUNAS.map(([c]) => c).filter((c) => !mapa.has(c)) };
  }
  return null;
}
