// Mensagem de erro segura para mostrar na tela. Quando o banco/servidor está fora, o erro chega como a página HTML
// inteira da Cloudflare (ex: "522 connection timed out"); mostrar isso cru enche a tela de código (visto na aba
// Panorama do card em 04/11/2026). Aqui qualquer texto com cara de HTML vira um aviso curto em português.
export function textoDeErroSeguro(mensagem: string | null | undefined): string {
  const t = String(mensagem ?? "").trim();
  if (/<\s*(!doctype|html|head|body|div|span|h\d|script)\b/i.test(t) || /error code:?\s*5\d\d/i.test(t)) {
    return "O sistema demorou a responder (instabilidade momentânea). Aguarde alguns instantes e tente de novo.";
  }
  return t.length > 400 ? `${t.slice(0, 400)}…` : t;
}
