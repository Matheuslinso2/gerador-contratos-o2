import { normalizarTextoBusca } from "@/lib/googleSheetsProspeccao";

export const COLUNAS_INCENDIO = ["IMOBILIARIA", "SEGURADO", "CIDADE", "ALUGUEL"];
export const COLUNAS_FIANCA = ["ANALISTA", "LOCATARIO", "ENDERECO", "ALUGUEL"];

export function pegarCampo(linha: Record<string, string>, ...nomesPossiveis: string[]): string {
  const chaves = Object.keys(linha);
  for (const nome of nomesPossiveis) {
    const alvo = normalizarTextoBusca(nome);
    const chave = chaves.find((k) => normalizarTextoBusca(k).includes(alvo));
    if (chave && linha[chave]) return linha[chave];
  }
  return "";
}

export function ehEfetivado(status: string): boolean {
  const s = normalizarTextoBusca(status);
  return s.includes("efetivado") && !s.includes("nao");
}

// Converte "R$ 2.370,00" / "778,97" (formato brasileiro) em número.
export function paraNumero(valor: string): number | null {
  const limpo = valor
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = parseFloat(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}
