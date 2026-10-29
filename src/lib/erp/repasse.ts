// ERP O2 — Repasse (Fase 1, só leitura). Uma única conta para qualquer tela (um número, uma resposta).
// Regra (Matheus 26-29/10/2026): comissão RECEBIDA de 1 a 30/31 do mês M → repasse do mês M+1, previsão dia 15.
// Linha = base da parcela × % de repasse × % de participação (calculada em erp_repasse_simulado); soma por imobiliária;
// desconto de 18% no total (5% ISS + 13% federais); valor fixo e premiação (RP) não sofrem desconto (ainda sem dados).
import type { SupabaseClient } from "@supabase/supabase-js";

export const DESCONTO_PCT = 18;

export type LinhaRepasse = {
  imobiliaria_id: string;
  imobiliaria: string;
  comissao_id: number;
  documento_id: string;
  segurado: string | null;
  seg_abrev: string | null;
  ramo: string | null;
  apolice: string | null;
  tipo_documento: string | null;
  parcela: string | null;
  recebida_em: string;
  previsao: string;
  pct_part: number;
  base: number;
  pct_rep: number;
  repasse: number;
  conferencia: string | null;
  pro_labore_direto: boolean;
};

export const arredonda = (v: number) => Math.round(v * 100) / 100;
export const totais = (linhas: { repasse: number }[]) => {
  const bruto = arredonda(linhas.reduce((s, l) => s + Number(l.repasse), 0));
  const desconto = arredonda((bruto * DESCONTO_PCT) / 100);
  return { bruto, desconto, liquido: arredonda(bruto - desconto) };
};

/** "AAAA-MM" do mês de repasse (padrão: o mês corrente, regra do ERP). */
export const mesRepasse = (mes?: string) => {
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const m = mes ?? `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  return { mes: m };
};
export const mesAnterior = (mes: string, n = 1) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const rotuloMes = (mes: string) => `${mes.slice(5)}/${mes.slice(0, 4)}`;

/** Linhas simuladas do repasse de um mês (opcionalmente de uma imobiliária). Sem gravar nada. */
export async function linhasDoMes(sb: SupabaseClient, mes: string, imobiliariaId?: string): Promise<LinhaRepasse[]> {
  const todas: LinhaRepasse[] = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.rpc("erp_repasse_simulado", { p_mes_repasse: `${mes}-01` });
    if (imobiliariaId) q = q.eq("imobiliaria_id", imobiliariaId);
    const { data } = await q.order("imobiliaria").order("segurado").order("apolice").order("comissao_id").range(de, de + 999);
    const lote = (data ?? []) as LinhaRepasse[];
    todas.push(...lote.map((l) => ({ ...l, base: Number(l.base), pct_rep: Number(l.pct_rep), pct_part: Number(l.pct_part), repasse: Number(l.repasse) })));
    if (lote.length < 1000) break;
  }
  return todas;
}

/** Alerta de repasse retido: extrato recebido ainda sem parcela (pendente de identificação) no mês do recebimento. */
export async function repasseRetidoPossivel(sb: SupabaseClient, mes: string) {
  try {
    const de = `${mesAnterior(mes)}-01`;
    const ate = `${mes}-01`;
    const { data, error } = await sb.from("erp_repasse_retido_possivel").select("valor_comissao").gte("pago_em", de).lt("pago_em", ate).limit(2000);
    if (error) return null;
    const v = (data ?? []) as { valor_comissao: number | null }[];
    return { linhas: v.length, valor: arredonda(v.reduce((s, x) => s + Number(x.valor_comissao ?? 0), 0)), truncado: v.length >= 2000 };
  } catch {
    return null;
  }
}
