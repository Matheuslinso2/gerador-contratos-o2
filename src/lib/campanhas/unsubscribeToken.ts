import { createHmac, timingSafeEqual } from "node:crypto";

// Token stateless (HMAC, não UUID persistido por destinatário): dá pra
// calcular tanto na hora de montar o e-mail quanto na hora de validar o
// clique, sem escrita nem round-trip ao banco antes do envio. O mesmo token
// vale pra qualquer campanha futura daquele e-mail.
function normalizar(email: string): string {
  return email.trim().toLowerCase();
}

export function gerarTokenDescadastro(email: string): string {
  const segredo = process.env.CAMPANHAS_UNSUB_SECRET;
  if (!segredo) throw new Error("CAMPANHAS_UNSUB_SECRET não configurada");
  return createHmac("sha256", segredo).update(normalizar(email)).digest("hex");
}

export function validarTokenDescadastro(email: string, token: string): boolean {
  const segredo = process.env.CAMPANHAS_UNSUB_SECRET;
  if (!segredo || !token) return false;
  const esperado = createHmac("sha256", segredo).update(normalizar(email)).digest("hex");
  const bufEsperado = Buffer.from(esperado, "hex");
  const bufRecebido = Buffer.from(token, "hex");
  if (bufEsperado.length !== bufRecebido.length) return false;
  return timingSafeEqual(bufEsperado, bufRecebido);
}

// Link mostrado no rodapé do e-mail -- página de confirmação manual (GET,
// não processa o opt-out sozinha, evita descadastro acidental por prefetch
// de scanners de antivírus/Outlook em links de e-mail).
export function linkDescadastro(email: string, origem: string): string {
  const token = gerarTokenDescadastro(email);
  const params = new URLSearchParams({ email, token });
  return `${origem}/campanhas/descadastro?${params.toString()}`;
}

// URL do header List-Unsubscribe (RFC 8058) -- os clientes de e-mail
// (Gmail/Outlook) fazem POST direto aqui quando a pessoa clica "Cancelar
// inscrição" na própria interface deles, sem abrir nenhuma página; o
// próprio cliente já exige um clique explícito antes de disparar esse POST,
// então não tem o mesmo risco de prefetch que o link de GET tem.
export function linkDescadastroApi(email: string, origem: string): string {
  const token = gerarTokenDescadastro(email);
  const params = new URLSearchParams({ email, token });
  return `${origem}/api/campanhas/descadastro?${params.toString()}`;
}
