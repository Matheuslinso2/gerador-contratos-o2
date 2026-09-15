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
