// Tendência de produção e baseline (03/11/2026). Funções puras, sem I/O.
//
// Método (Contador, "Seguros e Economia", ENS 2023, cap. 8): a série tem tendência,
// ciclos/sazonalidade e um componente aleatório. O filtro simples é o ACUMULADO
// MÓVEL DE 12 MESES (tira a sazonalidade e amortece o acaso) e, sobre ele, a TAXA
// DE CRESCIMENTO EM 12 MESES (tira a tendência). Aqui: últimos 12 meses antes do
// lançamento contra os 12 meses anteriores a eles.
//
// Contagem = contratações NOVAS (sem renovação) de Seguro Fiança e Capitalização,
// pela data de efetivação (ou de recebimento, se não houver), como no painel.

export type LinhaFunilBruta = {
  id: string;
  chave_caso: string | null;
  status_padrao: string | null;
  data_recebimento: string | null;
  data_efetivacao: string | null;
  tipo: string | null;
};

/** Datas (YYYY-MM-DD) das contratações novas de um conjunto de linhas do funil, uma por caso. */
export function datasDeContratacao(linhas: LinhaFunilBruta[]): string[] {
  const porCaso = new Map<string, LinhaFunilBruta[]>();
  for (const l of linhas) {
    const k = l.chave_caso || l.id;
    (porCaso.get(k) ?? porCaso.set(k, []).get(k)!).push(l);
  }
  const datas: string[] = [];
  for (const casos of porCaso.values()) {
    if (casos.some((c) => c.tipo === "renovacao")) continue; // renovação fora
    const conv = casos
      .filter((c) => c.status_padrao === "Convertido")
      .map((c) => c.data_efetivacao || c.data_recebimento)
      .filter((d): d is string => !!d)
      .sort();
    if (conv.length) datas.push(conv[0]);
  }
  return datas.sort();
}

export const somarDias = (data: string, dias: number): string => new Date(Date.parse(`${data}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
export const somarAnos = (data: string, anos: number): string => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + anos);
  return d.toISOString().slice(0, 10);
};

export const contarNoPeriodo = (datas: string[], de: string, ate: string): number => datas.filter((d) => d >= de && d <= ate).length;

/** Meses (inteiros) entre a primeira contratação e a data de corte; 0 se nunca contratou. */
export function mesesDeHistorico(datas: string[], corte: string): number {
  const primeira = datas[0];
  if (!primeira || primeira > corte) return 0;
  const [a1, m1] = primeira.split("-").map(Number);
  const [a2, m2] = corte.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

export type Tendencia = "Crescimento" | "Estagnação" | "Queda" | "Dados insuficientes";

export const FAIXA_ESTAGNACAO = 0.2; // ±20% (decisão a confirmar com o Matheus)
export const MIN_CONTRATACOES = 10; // soma dos dois períodos de 12 meses para classificar
export const MIN_MESES_HISTORICO = 18;

export type ResultadoTendencia = {
  tendencia: Tendencia;
  ultimos12m: number; // 12 meses antes do lançamento
  anteriores12m: number; // os 12 meses anteriores a esses
  variacao: number | null; // (ultimos / anteriores) - 1
  mesesHistorico: number;
  motivo: string | null; // por que ficou "dados insuficientes"
};

export function classificarTendencia(datas: string[], lancamento: string): ResultadoTendencia {
  const fimUltimos = somarDias(lancamento, -1);
  const iniUltimos = somarDias(somarAnos(lancamento, -1), 0);
  const fimAnteriores = somarDias(iniUltimos, -1);
  const iniAnteriores = somarAnos(iniUltimos, -1);
  const ultimos = contarNoPeriodo(datas, iniUltimos, fimUltimos);
  const anteriores = contarNoPeriodo(datas, iniAnteriores, fimAnteriores);
  const meses = mesesDeHistorico(datas, fimUltimos);
  const base = { ultimos12m: ultimos, anteriores12m: anteriores, mesesHistorico: meses };
  if (meses < MIN_MESES_HISTORICO) return { ...base, tendencia: "Dados insuficientes", variacao: anteriores > 0 ? ultimos / anteriores - 1 : null, motivo: `só ${meses} meses de histórico (mínimo ${MIN_MESES_HISTORICO})` };
  if (ultimos + anteriores < MIN_CONTRATACOES) return { ...base, tendencia: "Dados insuficientes", variacao: anteriores > 0 ? ultimos / anteriores - 1 : null, motivo: `volume baixo (${ultimos + anteriores} contratações em 24 meses; mínimo ${MIN_CONTRATACOES})` };
  if (anteriores === 0) return { ...base, tendencia: "Crescimento", variacao: null, motivo: "sem contratações no ano anterior" };
  const variacao = ultimos / anteriores - 1;
  return { ...base, variacao, motivo: null, tendencia: variacao > FAIXA_ESTAGNACAO ? "Crescimento" : variacao < -FAIXA_ESTAGNACAO ? "Queda" : "Estagnação" };
}

export type Baseline = {
  mesmoPeriodoAnoAnterior: number; // contratações no mesmo período um ano antes (sazonal, mas com poucos casos)
  ritmoRecente: number; // média mensal dos últimos 12 meses × meses do período (estável, mas ignora a sazonalidade)
  usado: number; // o que vale como "o que produziria sem a campanha"
  criterio: "média do mesmo período do ano anterior e do ritmo recente" | "ritmo dos últimos 12 meses";
  intervalo: [number, number]; // margem aproximada (Poisson, 95%) sobre o valor usado
};

/** Intervalo aproximado de 95% para uma contagem (aproximação normal de Poisson; margem ampla para n pequeno). */
export function intervaloPoisson(n: number): [number, number] {
  if (n <= 0) return [0, 3];
  const m = 1.96 * Math.sqrt(n);
  return [Math.max(0, Math.round((n - m) * 10) / 10), Math.round((n + m + 1) * 10) / 10];
}

/** Baseline do período individual [inicio, fim]: o que a imobiliária produziria sem a campanha. */
export function baselineDoPeriodo(datas: string[], inicio: string, fim: string, lancamento: string, mesesHistorico: number): Baseline {
  const anoAnterior = contarNoPeriodo(datas, somarAnos(inicio, -1), somarAnos(fim, -1));
  const ultimos12 = contarNoPeriodo(datas, somarAnos(lancamento, -1), somarDias(lancamento, -1));
  const diasPeriodo = Math.round((Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${inicio}T12:00:00Z`)) / 86_400_000) + 1;
  const ritmo = Math.round(((ultimos12 / 365.25) * diasPeriodo) * 10) / 10;
  // Os dois estimadores erram de jeitos diferentes: o do ano anterior respeita a sazonalidade mas tem poucos casos;
  // o do ritmo é estável mas ignora a sazonalidade. Usa a média (precisa de 15 meses de histórico para o primeiro)
  // e a margem cobre também a divergência entre eles.
  const usaDois = mesesHistorico >= 15;
  const usado = usaDois ? Math.round(((anoAnterior + ritmo) / 2) * 10) / 10 : ritmo;
  const [baixo, alto] = intervaloPoisson(usado);
  const intervalo: [number, number] = usaDois ? [Math.min(baixo, anoAnterior, ritmo), Math.max(alto, anoAnterior, ritmo)] : [baixo, alto];
  return { mesmoPeriodoAnoAnterior: anoAnterior, ritmoRecente: ritmo, usado, criterio: usaDois ? "média do mesmo período do ano anterior e do ritmo recente" : "ritmo dos últimos 12 meses", intervalo };
}

export type QuadranteAcao = { quadrante: string; acao: string };

/** Matriz tendência de produção × nível de engajamento (resposta). */
export function matrizDeAcao(tendencia: Tendencia, nivelResposta: string): QuadranteAcao {
  const nivel = nivelResposta === "Alto" ? "alto" : nivelResposta === "Indisponível" ? "indisp" : "baixo"; // Médio/Baixo/Sem contato = "baixo"
  if (tendencia === "Dados insuficientes") return { quadrante: "Sem leitura", acao: "Acompanhar: volume ou histórico insuficiente para classificar a tendência." };
  if (nivel === "indisp") return { quadrante: "Engajamento indisponível", acao: "Vincular a empresa no Bitrix para medir o engajamento." };
  const tabela: Record<string, Record<string, QuadranteAcao>> = {
    Queda: { alto: { quadrante: "Queda com engajamento alto", acao: "Investigar oferta, preço ou concorrência: o relacionamento existe e a produção cai." }, baixo: { quadrante: "Queda com engajamento baixo", acao: "Reativar o relacionamento: pouca resposta e produção caindo (risco de perda)." } },
    "Estagnação": { alto: { quadrante: "Estagnada com engajamento alto", acao: "Há espaço: aumentar a ambição da meta e das ofertas." }, baixo: { quadrante: "Estagnada com engajamento baixo", acao: "Aproximar a equipe antes de cobrar meta." } },
    Crescimento: { alto: { quadrante: "Crescimento com engajamento alto", acao: "Manter e proteger a conta." }, baixo: { quadrante: "Crescimento com engajamento baixo", acao: "Cresce por conta própria: não depende da campanha; cuidado para não superestimar o efeito." } },
  };
  return tabela[tendencia][nivel];
}
