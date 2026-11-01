// Máscara de segredos para textos livres vindos do Corp (aba Observações etc.): o valor que vem depois de senha/login/usuário/token/pin
// é trocado por ***. O texto continua útil (comissão, repasse, pró-labore) sem guardar credencial. Regra do Matheus, 01/11/2026.
const PALAVRAS = String.raw`senha|password|passwd|pwd|login|usu[aá]rio(?:\/senha)?|usuario(?:\/senha)?|user|token|pin|chave|c[oó]digo de acesso`;
// "senha: abc123", "senha=abc123", "SENHA É abc123", "login abc123", "usuário/senha: x / y"
const COM_SEPARADOR = new RegExp(
  String.raw`(?<![\p{L}\d])(${PALAVRAS})(?![\p{L}\d])(\s*(?:[:=\-–]|[eé](?![\p{L}])|\bde\b)?\s*)([^\s;,|]+(?:\s*\/\s*[^\s;,|]+)?)`,
  "giu"
);
export function mascararSegredos(texto: string): string {
  return texto.replace(COM_SEPARADOR, (todo, palavra: string, sep: string, valor: string) => {
    // palavra solta sem credencial depois (ex.: "acesso liberado", "login não funciona"): deixa como está
    if (/^(liberado|bloqueado|negado|ok|n[aã]o|sim|ao|do|da|de|no|na|para|em|funciona|funcionou|expirou)$/i.test(valor)) return todo;
    return `${palavra}${sep}***`;
  });
}
