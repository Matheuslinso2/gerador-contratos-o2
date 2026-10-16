// Remetente "nominal" das campanhas (pedido do Matheus, 16/10/2026): o setor
// comercial percebe que a imobiliária abre mais quando o e-mail parece vir de
// uma pessoa (ex: "Henrique | O2 Seguros") do que de "O2 Seguros". Muda só o
// NOME DE EXIBIÇÃO na caixa de entrada -- o endereço de envio continua o
// mesmo (ENDERECO_REMETENTE_CAMPANHAS) e nada é configurado em resposta.

const NOME_PADRAO = "O2 Seguros";
const LIMITE_CARACTERES = 40;

// Só letras (com acento), números, espaço, hífen e apóstrofo: o nome vai
// dentro do cabeçalho "From" e caracteres como < > " , ; quebrariam o e-mail.
export function limparNomeRemetente(valor: unknown): string | null {
  const limpo = String(valor ?? "")
    .replace(/[^\p{L}\p{N} '\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITE_CARACTERES)
    .trim();
  return limpo || null;
}

// Nome que aparece na caixa de entrada de quem recebe.
export function nomeExibidoRemetente(nomePessoa: string | null | undefined): string {
  const pessoa = limparNomeRemetente(nomePessoa);
  return pessoa ? `${pessoa} | ${NOME_PADRAO}` : NOME_PADRAO;
}
