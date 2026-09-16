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

// Pares fixos de calendário ancorados em mês ímpar (Jan-Fev, Mar-Abr, ...,
// Nov-Dez). O par que contém "hoje" nunca está fechado (hoje sempre cai
// dentro dele, não depois) -- o par fechado é sempre os 2 meses anteriores
// a esse. Confere com o exemplo do estudo: em setembro, o par fechado é
// julho-agosto; setembro só "acompanha" até outubro fechar o próximo par.
export function parFechado(hoje: Date = new Date()): [string, string] {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  const inicioParCorrente = mes % 2 === 1 ? mes : mes - 1;
  let inicioFechado = inicioParCorrente - 2;
  let anoFechado = ano;
  if (inicioFechado < 1) {
    inicioFechado += 12;
    anoFechado -= 1;
  }
  const mesA = String(inicioFechado).padStart(2, "0");
  const mesB = String(inicioFechado + 1).padStart(2, "0");
  return [`${anoFechado}-${mesA}`, `${anoFechado}-${mesB}`];
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
