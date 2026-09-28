// Personalização de campanha (pedido do Matheus, 26/09/2026): "apelido" troca
// o espaço reservado {{apelido}} pelo nome da imobiliária de cada destinatário
// (ver src/lib/nomeParaComunicacao.ts). Sem imports de servidor -- também é
// usado pelo editor (client).

export type ModoPersonalizacao = "nenhuma" | "apelido";

export const TOKEN_APELIDO = "{{apelido}}";

// Nome usado na prévia e no e-mail de teste (não têm imobiliária real vinculada).
export const NOME_EXEMPLO_PREVIA = "Imobiliária Exemplo";

// O editor insere o token dentro de um <span class="merge-apelido"> (só pra
// aparecer destacado na edição); no e-mail final o span some junto com o token.
const TOKEN_COM_SPAN = /<span[^>]*class="merge-apelido"[^>]*>\s*\{\{apelido\}\}\s*<\/span>|\{\{apelido\}\}/g;

export function contemApelido(texto: string | null | undefined): boolean {
  return !!texto && /\{\{apelido\}\}/.test(texto);
}

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// `nome` null = destinatário sem imobiliária vinculada (equipe interna,
// contato de prospecção) -- o espaço reservado some em vez de aparecer cru.
// `html: false` pro assunto (texto puro, não pode sair com &amp; literal).
export function aplicarApelido(texto: string, nome: string | null, { html = true }: { html?: boolean } = {}): string {
  return texto.replace(TOKEN_COM_SPAN, nome ? (html ? escaparHtml(nome) : nome) : "");
}
