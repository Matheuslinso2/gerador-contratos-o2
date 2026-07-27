// Substitui códigos que a imobiliária pode usar dentro do texto-base do
// contrato, pra dado que varia por locação aparecer dentro da própria
// cláusula (e não só isolado no bloco de Dados da Locação).
export function substituirPlaceholders(texto: string, dados: { diaVencimentoAluguel: number }): string {
  return texto.replace(/\{\{\s*dia[_ ]?vencimento\s*\}\}/gi, String(dados.diaVencimentoAluguel));
}
