const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = [
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos",
];

// Converte um número de 0 a 999 pra português por extenso.
function grupoPorExtenso(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";

  const partes: string[] = [];
  const centena = Math.floor(n / 100);
  const resto = n % 100;

  if (centena > 0) partes.push(CENTENAS[centena]);

  if (resto > 0) {
    if (resto < 10) {
      partes.push(UNIDADES[resto]);
    } else if (resto < 20) {
      partes.push(DEZ_A_DEZENOVE[resto - 10]);
    } else {
      const dezena = Math.floor(resto / 10);
      const unidade = resto % 10;
      partes.push(unidade > 0 ? `${DEZENAS[dezena]} e ${UNIDADES[unidade]}` : DEZENAS[dezena]);
    }
  }

  return partes.join(" e ");
}

// Converte um número inteiro (0 a 999.999.999) pra português por extenso —
// suficiente pra prazos, valores e quantidades usados em contratos.
export function numeroPorExtenso(valor: number): string {
  const n = Math.trunc(Math.abs(valor));
  if (n === 0) return "zero";

  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const unidades = n % 1000;

  const partes: string[] = [];
  if (milhoes > 0) {
    partes.push(milhoes === 1 ? "um milhão" : `${grupoPorExtenso(milhoes)} milhões`);
  }
  if (milhares > 0) {
    partes.push(milhares === 1 ? "mil" : `${grupoPorExtenso(milhares)} mil`);
  }
  if (unidades > 0) {
    partes.push(grupoPorExtenso(unidades));
  }

  return partes.join(" e ");
}

// Valor monetário em reais por extenso, no padrão usado em contratos
// (ex: "dois mil e oitocentos reais", "mil e quinhentos reais e vinte centavos").
export function valorPorExtensoReais(valor: number): string {
  const inteiro = Math.trunc(Math.abs(valor));
  const centavos = Math.round((Math.abs(valor) - inteiro) * 100);

  const reaisTexto = inteiro === 1 ? "um real" : `${numeroPorExtenso(inteiro)} reais`;
  if (centavos === 0) return reaisTexto;

  const centavosTexto = centavos === 1 ? "um centavo" : `${numeroPorExtenso(centavos)} centavos`;
  return `${reaisTexto} e ${centavosTexto}`;
}
