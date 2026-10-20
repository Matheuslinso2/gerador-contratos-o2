// Produtos e tipos de sinistro do dashboard (Fase B, 20/10/2026: todos os
// ramos do Corp). As chaves de produto são as mesmas de
// produto_sinistro_de_ramo() no banco e do importador
// (scripts/sinistros/importar-corp.mjs). Seguro Incêndio é produto próprio,
// nunca garantia locatícia.

export const PRODUTOS: { chave: string; rotulo: string }[] = [
  { chave: "fianca", rotulo: "Seguro Fiança" },
  { chave: "capitalizacao", rotulo: "Capitalização" },
  { chave: "incendio", rotulo: "Seguro Incêndio" },
  { chave: "residencial", rotulo: "Residencial" },
  { chave: "condominio", rotulo: "Condomínio" },
  { chave: "empresarial", rotulo: "Empresarial" },
  { chave: "automovel", rotulo: "Automóvel" },
  { chave: "conteudo", rotulo: "Conteúdo" },
  { chave: "portateis", rotulo: "Equipamentos portáteis" },
  { chave: "rc", rotulo: "Responsabilidade civil" },
  { chave: "vida", rotulo: "Vida" },
  { chave: "prestamista", rotulo: "Prestamista" },
  { chave: "viagem", rotulo: "Viagem" },
  { chave: "outros", rotulo: "Outros" },
];

export function rotuloProduto(chave: string | null | undefined) {
  return PRODUTOS.find((p) => p.chave === chave)?.rotulo ?? chave ?? "—";
}

// Ordena as chaves vindas do banco pela ordem de PRODUTOS.
export function ordenarProdutos(chaves: string[]) {
  const pos = (c: string) => {
    const i = PRODUTOS.findIndex((p) => p.chave === c);
    return i < 0 ? PRODUTOS.length : i;
  };
  return [...chaves].sort((a, b) => pos(a) - pos(b));
}

// Tipo do sinistro: na Fiança vem do tipo (ocupado/chaves); na Capitalização,
// do motivo do resgate tirado da Descrição do Corp.
export const TIPOS_SINISTRO: { valor: string; rotulo: string; produto: string | null }[] = [
  { valor: "ocupado", rotulo: "Imóvel ocupado", produto: "fianca" },
  { valor: "chaves", rotulo: "Entrega de chaves", produto: "fianca" },
  { valor: "cap_execucao", rotulo: "Resgate por execução / jurídico", produto: "capitalizacao" },
  { valor: "cap_acordo", rotulo: "Divisão de valores / acordo", produto: "capitalizacao" },
  { valor: "cap_debitos", rotulo: "Resgate com débitos", produto: "capitalizacao" },
  { valor: "cap_reaplicacao", rotulo: "Resgate final c/ reaplicação cancelada", produto: "capitalizacao" },
  { valor: "cap_administrativo", rotulo: "Troca de titular / liberação", produto: "capitalizacao" },
  { valor: "cap_resgate", rotulo: "Resgate simples", produto: "capitalizacao" },
  { valor: "nao_informado", rotulo: "Não informado", produto: null },
];

export function rotuloTipoSinistro(valor: string | null | undefined) {
  return TIPOS_SINISTRO.find((t) => t.valor === (valor ?? "nao_informado"))?.rotulo ?? valor ?? "—";
}
