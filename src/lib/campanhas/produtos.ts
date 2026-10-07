// Mesmos produtos de src/lib/produtosLandingPage.tsx (fonte única das
// fichas públicas), com rótulo mais curto (ex: "Fiança" em vez de "Ficha
// Fiança") por fazer mais sentido numa campanha, e "institucional" a mais
// pra campanha que não é sobre um produto específico.
export const PRODUTOS_CAMPANHA = [
  { valor: "fianca", rotulo: "Fiança" },
  { valor: "incendio", rotulo: "Incêndio" },
  { valor: "capitalizacao", rotulo: "Capitalização" },
  { valor: "automovel", rotulo: "Automóvel" },
  { valor: "rc_obras", rotulo: "RC Obras" },
  { valor: "seguro_celular", rotulo: "Seguro Celular" },
  { valor: "rcp", rotulo: "RCP" },
  { valor: "condominio", rotulo: "Condomínio" },
  { valor: "institucional", rotulo: "Institucional / Geral" },
] as const;

export type ProdutoCampanha = (typeof PRODUTOS_CAMPANHA)[number]["valor"];

const MAPA_ROTULOS: Record<string, string> = Object.fromEntries(PRODUTOS_CAMPANHA.map((p) => [p.valor, p.rotulo]));

export function rotuloProdutoCampanha(produto: string | null | undefined): string {
  if (!produto) return "—";
  return MAPA_ROTULOS[produto] ?? produto;
}

// Pedido do Matheus, 07/10/2026: uma campanha pode ter mais de um produto.
// `produtos` (array) é a fonte da verdade; `produto` (texto único, legado)
// segue gravado com o primeiro escolhido.
const VALORES_PRODUTOS = new Set<string>(PRODUTOS_CAMPANHA.map((p) => p.valor));

// Lê os checkboxes do formulário: só valores válidos, sem repetir, na
// ordem em que a lista oficial define (não na ordem do clique).
export function lerProdutosDoFormulario(valores: FormDataEntryValue[]): string[] {
  const marcados = new Set(valores.map((v) => String(v)).filter((v) => VALORES_PRODUTOS.has(v)));
  return PRODUTOS_CAMPANHA.map((p) => p.valor).filter((v) => marcados.has(v));
}

// Campanhas antigas (antes da migração campanhas_produtos_multiplos) só têm
// `produto` -- a migração já copiou, mas não custa ser tolerante.
export function produtosDaCampanha(campanha: { produtos?: string[] | null; produto?: string | null }): string[] {
  if (campanha.produtos?.length) return campanha.produtos;
  return campanha.produto ? [campanha.produto] : [];
}

export function rotulosProdutosCampanha(produtos: string[]): string {
  return produtos.length ? produtos.map((p) => rotuloProdutoCampanha(p)).join(", ") : "—";
}
