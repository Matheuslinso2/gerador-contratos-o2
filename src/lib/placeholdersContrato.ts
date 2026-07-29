import { numeroPorExtenso, valorPorExtensoReais } from "./numeroPorExtenso";

// Substitui códigos que a imobiliária pode usar dentro do texto-base do
// contrato, pra dado que varia por locação aparecer dentro da própria
// cláusula (e não só isolado no bloco de Dados da Locação). Esses marcadores
// tanto podem ser digitados manualmente pela imobiliária quanto inseridos
// automaticamente pelo preparo do texto-base (ver src/lib/limparTextoBase.ts).
export function substituirPlaceholders(
  texto: string,
  dados: {
    diaVencimentoAluguel: number;
    dataTermino: string;
    locador?: string;
    locatario?: string;
    enderecoImovel?: string;
    valorAluguel?: number;
    dataInicio?: string;
    prazoMeses?: number;
  }
): string {
  let resultado = texto
    .replace(/\{\{\s*dia[_ ]?vencimento\s*\}\}/gi, String(dados.diaVencimentoAluguel))
    .replace(/\{\{\s*data[_ ]?t[ée]rmino\s*\}\}/gi, fmtDataBr(dados.dataTermino));

  if (dados.locador !== undefined) resultado = resultado.replace(/\{\{\s*locador\s*\}\}/gi, dados.locador);
  if (dados.locatario !== undefined) resultado = resultado.replace(/\{\{\s*locat[aá]rio\s*\}\}/gi, dados.locatario);
  if (dados.enderecoImovel !== undefined)
    resultado = resultado.replace(/\{\{\s*endereco[_ ]?im[oó]vel\s*\}\}/gi, dados.enderecoImovel);
  if (dados.valorAluguel !== undefined) {
    resultado = resultado
      .replace(
        /\{\{\s*valor[_ ]?aluguel\s*\}\}/gi,
        `R$ ${dados.valorAluguel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
      )
      .replace(/\{\{\s*valor[_ ]?aluguel[_ ]?extenso\s*\}\}/gi, valorPorExtensoReais(dados.valorAluguel));
  }
  if (dados.dataInicio !== undefined)
    resultado = resultado.replace(/\{\{\s*data[_ ]?in[ií]cio\s*\}\}/gi, fmtDataBr(dados.dataInicio));
  if (dados.prazoMeses !== undefined) {
    resultado = resultado
      .replace(/\{\{\s*prazo[_ ]?meses\s*\}\}/gi, String(dados.prazoMeses))
      .replace(/\{\{\s*prazo[_ ]?meses[_ ]?extenso\s*\}\}/gi, numeroPorExtenso(dados.prazoMeses));
  }

  return resultado;
}

// Substitui os códigos usados na cláusula-base de produtos de Título de
// Capitalização, onde o valor do título e o número da proposta/garantia
// mudam a cada locação (extraídos da proposta anexada na hora de gerar).
export function substituirPlaceholdersTitulo(
  texto: string,
  dados: { valorTitulo: number; numeroProposta: string }
): string {
  const valorFormatado = dados.valorTitulo.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  return texto
    .replace(/\{\{\s*valor[_ ]?t[ií]tulo\s*\}\}/gi, valorFormatado)
    .replace(/\{\{\s*n[uú]mero[_ ]?proposta\s*\}\}/gi, dados.numeroProposta);
}

export const fmtDataBr = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

// Contratos reais costumam declarar a data de encerramento (calculada a
// partir do início + prazo) direto na cláusula de prazo, não só o número de
// meses — ex: "...findando-se em 01/01/2029". A convenção usada em contratos
// reais é o ÚLTIMO DIA de vigência (início + prazo - 1 dia), não o mesmo dia
// do mês seguinte — ex: início 15/08/2025 + 30 meses = término 14/02/2028.
export function calcularDataTermino(dataInicioIso: string, prazoMeses: number): string {
  const [ano, mes, dia] = dataInicioIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1 + prazoMeses, dia - 1));
  const y = data.getUTCFullYear();
  const m = String(data.getUTCMonth() + 1).padStart(2, "0");
  const d = String(data.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
