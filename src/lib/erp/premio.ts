// ERP O2 — prêmio padronizado pelo PRÊMIO LÍQUIDO (Matheus 28/10/2026):
//   Prêmio total = prêmio líquido + IOF  (+ adicional de fracionamento, quando houver parcelamento com juros).
// O valor digitado no card do Bitrix depende do produto (prova com 248 PDFs de set–out/2026):
//   • Fiança → o card guarda o LÍQUIDO (total = card × 1,0738);
//   • incêndio (imobiliário, residencial, empresarial) → o card guarda o TOTAL pago pelo cliente (líquido = card ÷ 1,0738);
//   • capitalização → sem IOF (total = líquido).
// Demais produtos (automóvel, condomínio, portáteis, RC, vida…) ainda sem prova: mantêm líquido = total = valor do card, sem IOF.
// O líquido é a base de comissão e de repasse.
export const ALIQUOTA_IOF = 0.0738;

export type PremioSeparado = { liquido: number; iof: number; total: number };

const centavos = (n: number) => Math.round(n * 100) / 100;

export function separarPremio(produto: string | null | undefined, valorDoCard: number): PremioSeparado {
  const v = Number(valorDoCard) || 0;
  if (v <= 0) return { liquido: 0, iof: 0, total: 0 };
  if (produto === "fianca") {
    const iof = centavos(v * ALIQUOTA_IOF);
    return { liquido: centavos(v), iof, total: centavos(v + iof) };
  }
  if (produto === "incendio") {
    const liquido = centavos(v / (1 + ALIQUOTA_IOF));
    return { liquido, iof: centavos(v - liquido), total: centavos(v) };
  }
  return { liquido: centavos(v), iof: 0, total: centavos(v) };
}
