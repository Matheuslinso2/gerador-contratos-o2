// Substitui códigos que a imobiliária pode usar dentro do texto-base do
// contrato, pra dado que varia por locação aparecer dentro da própria
// cláusula (e não só isolado no bloco de Dados da Locação).
export function substituirPlaceholders(
  texto: string,
  dados: { diaVencimentoAluguel: number; dataTermino: string }
): string {
  return texto
    .replace(/\{\{\s*dia[_ ]?vencimento\s*\}\}/gi, String(dados.diaVencimentoAluguel))
    .replace(/\{\{\s*data[_ ]?t[ée]rmino\s*\}\}/gi, fmtDataBr(dados.dataTermino));
}

const fmtDataBr = (iso: string) => {
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
