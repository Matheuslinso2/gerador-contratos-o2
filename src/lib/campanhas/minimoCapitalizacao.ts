// Valor mínimo do título de Capitalização por participante (04/11/2026, regra
// exclusiva da Campanha Elite: Expan e Adjuve só contam títulos de R$ 4.000,00
// ou mais). Fica em campanhas_metas.cap_valor_minimo; vazio = sem regra.
//
// O corte é por CASO (um título = um caso, mesmo que tenha mais de uma linha na
// base): vale o maior valor_titulo entre as linhas do caso. Caso sem valor
// informado NÃO é contado (não dá para provar que chega ao mínimo) e é avisado.
// Puro (sem server-only) para o script da foto de partida usar a mesma regra.

export const PRODUTO_CAPITALIZACAO = "capitalizacao";

type LinhaMinimo = {
  id: string;
  chave_caso: string | null;
  imobiliaria_id: string;
  produto: string;
  status_padrao: string | null;
  data_recebimento: string | null;
  data_efetivacao: string | null;
  herdada: boolean | null;
  valor_titulo: number | null;
};

export type CasoDescartado = {
  imobiliariaId: string;
  data: string | null; // entrada do título (ou a data de conversão, se não houver entrada)
  convertido: boolean;
  semValor: boolean;
};

export function aplicarMinimoCapitalizacao<T extends LinhaMinimo>(
  linhas: T[],
  minimoPorFicha: Map<string, number>
): { linhas: T[]; descartados: CasoDescartado[] } {
  if (!minimoPorFicha.size) return { linhas, descartados: [] };
  const porCaso = new Map<string, T[]>();
  for (const l of linhas) {
    const chave = l.chave_caso || l.id;
    const lista = porCaso.get(chave);
    if (lista) lista.push(l);
    else porCaso.set(chave, [l]);
  }
  const fora = new Set<string>();
  const descartados: CasoDescartado[] = [];
  for (const [chave, casos] of porCaso) {
    const primeira = casos[0];
    const minimo = minimoPorFicha.get(primeira.imobiliaria_id);
    if (!minimo || primeira.produto !== PRODUTO_CAPITALIZACAO) continue;
    const valores = casos.map((c) => Number(c.valor_titulo)).filter((v) => Number.isFinite(v) && v > 0);
    const maior = valores.length ? Math.max(...valores) : null;
    if (maior !== null && maior >= minimo) continue;
    fora.add(chave);
    const entradas = casos.filter((c) => !c.herdada && c.data_recebimento).map((c) => c.data_recebimento!).sort();
    const convertidos = casos.filter((c) => c.status_padrao === "Convertido");
    const datasConversao = convertidos.map((c) => c.data_efetivacao || c.data_recebimento).filter((d): d is string => !!d).sort();
    descartados.push({
      imobiliariaId: primeira.imobiliaria_id,
      data: entradas[0] ?? datasConversao[0] ?? null,
      convertido: convertidos.length > 0,
      semValor: maior === null,
    });
  }
  if (!fora.size) return { linhas, descartados };
  return { linhas: linhas.filter((l) => !fora.has(l.chave_caso || l.id)), descartados };
}
