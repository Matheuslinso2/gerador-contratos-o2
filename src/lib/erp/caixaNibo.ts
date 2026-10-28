// ERP O2 — conferência de caixa dentro da tela de baixa (28/10/2026).
// O banco (Nibo, categoria "1.1 - RECEITA DE SEGUROS") é o fiel da balança: cada lançamento do Nibo é a soma dos extratos
// pagos naquele dia por seguradora e empresa (fim de semana cai no dia útil seguinte). O Nibo registra o líquido ANTES do
// desconto da seguradora (ex.: empréstimo Porto entra como receita e como pagamento de empréstimo), por isso a comparação
// usa liquido_sem_desconto do extrato. Só leitura: nada é gravado no Nibo nem no banco.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const TOLERANCIA_CAIXA = 6; // R$ por parcela (regra do Matheus, 28/10); no total do mês só serve de limite do "bate"

export type EntradaNibo = { corretora: string; seg: string; dia: string; valor: number };
export type ExtratoDia = { seg: string; corretora: string | null; dia: string; liquido: number; bruto: number; linhas: number };
export type DiaCaixa = { dia: string; banco: number; extrato: number; dif: number };

const EMPRESA: Record<string, string> = { corretora: "O2 Corretora", capitalizacao: "O2 Capitalização" };

// nome do fornecedor no Nibo → abreviação em erp_seguradoras (Liberty virou Yelum; no Nibo ainda aparece como Liberty)
const FORNECEDOR: [RegExp, string][] = [
  [/toki/i, "TOKI"], [/porto/i, "PORT"], [/pottencial/i, "POTT"], [/allianz/i, "ALLI"], [/brasil ?cap/i, "BRAS"], [/^too\b/i, "TOO"],
  [/liberty|yelum/i, "YELU"], [/icatu/i, "ICAT"], [/alfa/i, "ALFA"], [/azul/i, "AZUL"], [/bradesco/i, "BRAD"], [/mapfre/i, "MAPF"],
  [/hdi/i, "HDI"], [/suhai/i, "SUHA"], [/sul ?am[eé]rica/i, "SULA"], [/zurich/i, "ZURI"],
];
export function segDoFornecedor(nome: string | null): string {
  for (const [re, abrev] of FORNECEDOR) if (nome && re.test(nome)) return abrev;
  return "OUTRAS";
}

// sábado e domingo caem na segunda-feira (feriados ficam como diferença para a equipe olhar)
export function diaDeCredito(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const w = d.getUTCDay();
  if (w === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (w === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function entradasNibo(sb: SupabaseClient, desde: string, ate: string): Promise<EntradaNibo[]> {
  const saida: EntradaNibo[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb
      .from("erp_nibo_lancamentos")
      .select("empresa, data, valor, stakeholder_nome")
      .eq("tipo", "recebimento")
      .eq("categoria", "1.1 - RECEITA DE SEGUROS")
      .gte("data", desde)
      .lte("data", ate)
      .order("data")
      .range(de, de + 999);
    const lote = (data ?? []) as { empresa: string; data: string; valor: number | string; stakeholder_nome: string | null }[];
    for (const l of lote) {
      const corretora = EMPRESA[l.empresa];
      if (!corretora) continue;
      saida.push({ corretora, seg: segDoFornecedor(l.stakeholder_nome), dia: l.data.slice(0, 10), valor: Number(l.valor) });
    }
    if (lote.length < 1000) break;
  }
  return saida;
}

// A Tokio (e outras) aparecem duas vezes: o extrato por apólice e o mesmo total vindo só como total. Conta uma vez:
// mesma seguradora × empresa × dia × total, fica o que tem mais linhas.
export function semDuplicados(extratos: ExtratoDia[]): ExtratoDia[] {
  const m = new Map<string, ExtratoDia>();
  for (const e of extratos) {
    const k = `${e.seg}|${e.corretora}|${e.dia}|${Math.round(e.bruto * 100)}`;
    const atual = m.get(k);
    if (!atual || e.linhas > atual.linhas) m.set(k, e);
  }
  return [...m.values()];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// chave: corretora|seg|AAAA-MM do dia de crédito
export function compararDias(extratos: ExtratoDia[], entradas: EntradaNibo[]): Map<string, DiaCaixa[]> {
  const dias = new Map<string, { banco: number; extrato: number }>();
  const pega = (corretora: string, seg: string, dia: string) => {
    const k = `${corretora}|${seg}|${dia}`;
    if (!dias.has(k)) dias.set(k, { banco: 0, extrato: 0 });
    return dias.get(k)!;
  };
  for (const e of semDuplicados(extratos)) {
    if (!e.corretora) continue;
    pega(e.corretora, e.seg, diaDeCredito(e.dia)).extrato += e.liquido;
  }
  for (const n of entradas) pega(n.corretora, n.seg, n.dia).banco += n.valor;
  const saida = new Map<string, DiaCaixa[]>();
  for (const [k, v] of dias) {
    const [corretora, seg, dia] = k.split("|");
    const chave = `${corretora}|${seg}|${dia.slice(0, 7)}`;
    if (!saida.has(chave)) saida.set(chave, []);
    saida.get(chave)!.push({ dia, banco: r2(v.banco), extrato: r2(v.extrato), dif: r2(v.banco - v.extrato) });
  }
  for (const lista of saida.values()) lista.sort((a, b) => a.dia.localeCompare(b.dia));
  return saida;
}

export type SituacaoCaixa = { codigo: "bate" | "banco_acima" | "extrato_acima" | "sem_banco" | "sem_extrato" | "aguardando"; texto: string; cor: string };
const SIT: Record<SituacaoCaixa["codigo"], SituacaoCaixa> = {
  aguardando: { codigo: "aguardando", texto: "Esperado, ainda não pagou", cor: "bg-gray-100 text-gray-700" },
  bate: { codigo: "bate", texto: "Bate com o banco", cor: "bg-green-100 text-green-800" },
  banco_acima: { codigo: "banco_acima", texto: "Banco acima do extrato", cor: "bg-orange-100 text-orange-800" },
  extrato_acima: { codigo: "extrato_acima", texto: "Extrato acima do banco", cor: "bg-red-100 text-red-700" },
  sem_banco: { codigo: "sem_banco", texto: "Sem entrada no banco", cor: "bg-red-100 text-red-700" },
  sem_extrato: { codigo: "sem_extrato", texto: "Sem extrato no ERP", cor: "bg-yellow-100 text-yellow-800" },
};

// esperado = líquido do extrato antes do desconto da seguradora (é assim que o Nibo registra)
export function situacaoCaixa(esperado: number | null, banco: number | null, previsto: number | null = null): SituacaoCaixa {
  if (esperado == null || esperado === 0) {
    if (banco && banco > 0) return SIT.sem_extrato;
    return previsto && previsto > TOLERANCIA_CAIXA ? SIT.aguardando : SIT.bate;
  }
  if (banco == null || banco === 0) return SIT.sem_banco;
  const dif = banco - esperado;
  if (Math.abs(dif) <= TOLERANCIA_CAIXA) return SIT.bate;
  return dif > 0 ? SIT.banco_acima : SIT.extrato_acima;
}
