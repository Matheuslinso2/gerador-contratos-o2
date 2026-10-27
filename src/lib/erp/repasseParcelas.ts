// ERP O2 — repasse previsto por parcela, para o demonstrativo da ficha (Matheus 27/10/2026).
// Regra do documento: repasse total = prêmio líquido × % de repasse × % de participação (já gravado em repasse_valor_previsto).
//  • Percentual: o repasse é PARCELADO em parcelas iguais (total ÷ nº de parcelas), mesmo no esgotamento — a seguradora
//    pode quitar a comissão cedo, mas a O2 segue repassando mês a mês.
//  • Fixo (percentual 0 e valor > 0): acordo de pagar UM valor por documento, uma única vez. Entra na 1ª parcela: a
//    competência é a do recebimento da primeira comissão e o pagamento é no mês seguinte.
// O pagamento é no dia 15 do mês seguinte ao do recebimento da comissão (relatório de repasse, antes do desconto de 18%).

export type ProdutorRepasse = { repasse_pct: number; repasse_valor_previsto: number };

export const repasseEhFixo = (p: ProdutorRepasse) => p.repasse_pct === 0 && p.repasse_valor_previsto > 0;

const centavos = (v: number) => Math.round(v * 100);

/** Repasse previsto de cada parcela (índice 0 = parcela 1); a soma fecha com o total do documento ao centavo. */
export function repassePorParcela(produtores: ProdutorRepasse[], qtdParcelas: number): number[] {
  if (qtdParcelas <= 0) return [];
  const fixo = produtores.filter(repasseEhFixo).reduce((s, p) => s + centavos(p.repasse_valor_previsto), 0);
  const pct = produtores.filter((p) => !repasseEhFixo(p)).reduce((s, p) => s + centavos(p.repasse_valor_previsto), 0);
  const base = Math.floor(pct / qtdParcelas);
  const resto = pct - base * qtdParcelas;
  return Array.from({ length: qtdParcelas }, (_, i) => (base + (i === qtdParcelas - 1 ? resto : 0) + (i === 0 ? fixo : 0)) / 100);
}

/** Dia 15 do mês seguinte à previsão de recebimento da comissão (AAAA-MM-DD), ou null sem previsão. */
export function dataDoRepasse(previsaoRecebimento: string | null): string | null {
  if (!previsaoRecebimento || !/^\d{4}-\d{2}-\d{2}/.test(previsaoRecebimento)) return null;
  const a = Number(previsaoRecebimento.slice(0, 4));
  const m = Number(previsaoRecebimento.slice(5, 7));
  const prox = new Date(Date.UTC(a, m, 15));
  return prox.toISOString().slice(0, 10);
}
