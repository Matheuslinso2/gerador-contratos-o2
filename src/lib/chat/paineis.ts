// Robô O2 dentro de cada painel do Workspace (pedido do Matheus, 04/11/2026): a mesma inteligência e as mesmas
// ferramentas do chat da equipe, mas com o foco no painel que a pessoa está olhando. Esta lista é a ÚNICA fonte
// dos painéis que têm o campo do robô: a tela (RoboDoPainel) e a rota (/api/chat/robo) usam o mesmo id.
// Sem "server-only" de propósito: o componente de tela também lê os nomes e as perguntas sugeridas.

export type PainelRobo = {
  nome: string;
  /** Nome do painel em consultar_painel (retratos mensais salvos no banco). */
  painel: string;
  /** Em uma frase: o que o painel mede. Vai para o robô, para ele saber o que é "isto". */
  oQueMede: string;
  /** Produto em producao_resolvida (cotações), quando existir. */
  produto?: string;
  sugestoes: string[];
};

export const PAINEIS_ROBO: Record<string, PainelRobo> = {
  fianca: {
    nome: "Seguro Fiança",
    painel: "seguro_fianca",
    produto: "fianca",
    oQueMede:
      "análises e cotações de Seguro Fiança (funis Análise e Cotação e Negociação e Contrato do Bitrix): solicitações, aprovadas, recusadas, perdidas, convertidas (efetivadas), prêmio e comissão efetivados, tempos por etapa, responsáveis, seguradoras e imobiliárias. As renovações de Fiança têm painel próprio (renovacao_fianca).",
    sugestoes: ["Resuma o mês em poucas linhas", "Quais imobiliárias mais converteram?", "Onde estamos perdendo mais análises?", "Como está a conversão por seguradora?"],
  },
  capitalizacao: {
    nome: "Capitalização",
    painel: "capitalizacao",
    produto: "capitalizacao",
    oQueMede:
      "títulos de Capitalização (SPA do Bitrix): aba Capitalização nova (cards criados no mês + herança; emitidos, não pagos, valor do título, comissão, status por imobiliária e por seguradora) e aba Reaplicação (funil de reaplicações: renovadas, não renovaram, vigência neste mês x outros meses).",
    sugestoes: ["Resuma o mês de Capitalização", "Quais imobiliárias têm mais títulos em aberto?", "Como estão as reaplicações do mês?", "Qual seguradora fechou mais?"],
  },
  auto: {
    nome: "Seguro Automóvel",
    painel: "seguro_auto",
    produto: "automovel",
    oQueMede: "fichas de Seguro Automóvel (SPA do Bitrix): convertidas, perdidas, em andamento, prêmio e comissão. Auto não tem imobiliária ligada ao card.",
    sugestoes: ["Resuma o mês de Auto", "Quantas fichas estão paradas?", "Qual a taxa de conversão?"],
  },
  ramos: {
    nome: "Ramos Elementares",
    painel: "ramos_elementares",
    produto: "re",
    oQueMede:
      "cotações de Ramos Elementares (Produção Incêndio no Bitrix): novos negócios, renovações (competência = vigência), endossos e financeiro. Sempre em CARDS e em ITENS (um lote é um card com vários itens).",
    sugestoes: ["Resuma o mês de Ramos", "Quais imobiliárias têm mais cards em aberto?", "Como estão as renovações do mês por vigência?", "Quantos itens foram contratados?"],
  },
  comercial: {
    nome: "Painel Comercial",
    painel: "comercial",
    oQueMede: "funis comerciais do Bitrix (Ativação de Novos Clientes e Sucesso do Cliente): sucesso, ativação, produção por responsável e qualidade dos dados.",
    sugestoes: ["Resuma o mês", "Quem mais produziu?", "Onde há cards parados?"],
  },
};

export type ContextoPainel = { id: string; competencia: string };

export function contextoPainelValido(c: unknown): ContextoPainel | null {
  if (!c || typeof c !== "object") return null;
  const { id, competencia } = c as { id?: unknown; competencia?: unknown };
  if (typeof id !== "string" || !PAINEIS_ROBO[id]) return null;
  if (typeof competencia !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) return null;
  return { id, competencia };
}
