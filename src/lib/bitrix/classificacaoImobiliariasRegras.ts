// Regras puras da classificação operacional das imobiliárias (estudo da
// Patricia, 16/09/2026) -- sem nenhum acesso a Bitrix/Supabase, por isso
// pode ser importado tanto pelo lado servidor (classificacaoImobiliarias.ts)
// quanto por um Client Component (ImobiliariasTabela.tsx). Separado de
// propósito: classificacaoImobiliarias.ts importa "./seguroFianca", que tem
// `import "server-only"` -- se esse arquivo importasse de lá, o Next.js
// recusa build ao tentar incluir isso no bundle do cliente.
export const CLASSES_ATIVAS = [
  { nome: "Pilar Central", cumulativo: 10 },
  { nome: "Consolidado", cumulativo: 30 },
  { nome: "Expansão", cumulativo: 60 },
  { nome: "Fiel da Balança", cumulativo: 85 },
  { nome: "Avulso", cumulativo: 100 },
] as const;

export const NOME_FORA_DE_LINHA = "Fora de Linha";

// Ordem de hierarquia (pra ordenar a coluna na tabela) -- do maior volume
// esperado pro menor, com "sem classe" (nunca teve atividade) no final.
export const ORDEM_HIERARQUIA = [...CLASSES_ATIVAS.map((c) => c.nome), NOME_FORA_DE_LINHA];

export type ClasseImobiliaria = { classe: string; volume: number };

// Janela móvel: os 2 últimos meses FECHADOS antes do mês atual (Brasília).
// Ex: em outubro/2026 -> agosto + setembro; em novembro -> setembro + outubro.
// Decisão do Matheus (02/10/2026): atualizar todo mês. Antes eram pares
// fixos de calendário (jan-fev, mar-abr...), que só trocavam de 2 em 2
// meses -- em outubro o painel ainda mostrava julho + agosto.
export function parFechado(hoje: Date = new Date()): [string, string] {
  const [ano, mes] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .format(hoje)
    .split("-")
    .map(Number);
  const mesAntes = (n: number) => {
    const d = new Date(Date.UTC(ano, mes - 1 - n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return [mesAntes(2), mesAntes(1)];
}

// Ranking por posição, respeitando empate (regra explícita do estudo:
// imobiliárias com o mesmo volume ficam juntas na mesma classe, mesmo que
// isso estoure a faixa-alvo -- nunca quebra um grupo empatado no meio).
export function classificarEixo(
  volumes: Record<string, number>,
  jaTeveAtividadeAntes: Set<string>
): Record<string, ClasseImobiliaria> {
  const resultado: Record<string, ClasseImobiliaria> = {};

  for (const [nome, volume] of Object.entries(volumes)) {
    if (volume === 0 && jaTeveAtividadeAntes.has(nome)) {
      resultado[nome] = { classe: NOME_FORA_DE_LINHA, volume: 0 };
    }
  }

  const ativos = Object.entries(volumes).filter(([, v]) => v > 0);
  if (!ativos.length) return resultado;
  ativos.sort((a, b) => b[1] - a[1]);

  const blocos: [string, number][][] = [];
  for (const par of ativos) {
    const ultimoBloco = blocos[blocos.length - 1];
    if (ultimoBloco && ultimoBloco[0][1] === par[1]) ultimoBloco.push(par);
    else blocos.push([par]);
  }

  const total = ativos.length;
  let consumidos = 0;
  let indiceClasse = 0;
  for (const bloco of blocos) {
    while (indiceClasse < CLASSES_ATIVAS.length - 1 && (consumidos / total) * 100 >= CLASSES_ATIVAS[indiceClasse].cumulativo) {
      indiceClasse++;
    }
    const classe = CLASSES_ATIVAS[indiceClasse].nome;
    for (const [nome, volume] of bloco) resultado[nome] = { classe, volume };
    consumidos += bloco.length;
  }

  return resultado;
}

// Cruzamento Cotação × Contratação (estudo da Patricia, slides "Prioridades
// para a operação" / "Cruzamento entre cotações e contratações") -- agrupa
// pelo padrão combinado das 2 classificações, cada um com uma ação sugerida.
// Não cobre todo mundo de propósito: só os 3 padrões que o estudo destaca,
// o resto da base não entra em nenhum grupo.
export type GrupoPrioridade = "lideranca" | "cotaMuitoFechaPouco" | "contratacaoDestaque";

export const ROTULO_GRUPO_PRIORIDADE: Record<GrupoPrioridade, string> = {
  lideranca: "Liderança nos dois eixos",
  cotaMuitoFechaPouco: "Cota muito, fecha pouco",
  contratacaoDestaque: "Contratação em destaque",
};

export const ACAO_GRUPO_PRIORIDADE: Record<GrupoPrioridade, string> = {
  lideranca: "Preservar nível de serviço e resolver pendências rapidamente",
  cotaMuitoFechaPouco: "Investigar recusas, preço, documentação e perdas",
  contratacaoDestaque: "Ampliar o envio de novas oportunidades de cotação",
};

const NIVEL_TOPO = new Set(["Pilar Central", "Consolidado"]);

function posicaoHierarquiaOuFim(classe: ClasseImobiliaria | null): number {
  if (!classe) return ORDEM_HIERARQUIA.length;
  const indice = ORDEM_HIERARQUIA.indexOf(classe.classe);
  return indice === -1 ? ORDEM_HIERARQUIA.length : indice;
}

export function classificarGrupoPrioridade(
  cotacoes: ClasseImobiliaria | null,
  contratacoes: ClasseImobiliaria | null
): GrupoPrioridade | null {
  if (cotacoes?.classe === "Pilar Central" && contratacoes?.classe === "Pilar Central") return "lideranca";
  // Expansão (posição 2) em diante conta como "baixo" no outro eixo.
  if (cotacoes && NIVEL_TOPO.has(cotacoes.classe) && posicaoHierarquiaOuFim(contratacoes) >= 2) return "cotaMuitoFechaPouco";
  if (contratacoes && NIVEL_TOPO.has(contratacoes.classe) && posicaoHierarquiaOuFim(cotacoes) >= 2) return "contratacaoDestaque";
  return null;
}
