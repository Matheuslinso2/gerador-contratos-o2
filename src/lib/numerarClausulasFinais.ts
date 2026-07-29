import Anthropic from "@anthropic-ai/sdk";

export type ResultadoInsercaoGarantia = {
  texto_final: string;
};

type Cabecalho = { linha: string; indiceLinha: number };

// Cláusulas costumam começar a linha com "CLÁUSULA"/"Cláusula" (numérico,
// com grau, ordinal por extenso etc.) — pega só a LINHA do cabeçalho, não o
// corpo, pra manter a chamada da IA pequena e rápida (reescrever o contrato
// inteiro via IA pra inserir 1 cláusula era lento demais e estourava o
// tempo limite da função em contratos grandes).
function extrairCabecalhos(texto: string): Cabecalho[] {
  const linhas = texto.split("\n");
  const cabecalhos: Cabecalho[] = [];
  linhas.forEach((linha, indiceLinha) => {
    if (/^\s*cl[aá]usula\b/i.test(linha) && linha.trim().length < 200) {
      cabecalhos.push({ linha, indiceLinha });
    }
  });
  return cabecalhos;
}

const SYSTEM_PROMPT = `Você recebe a lista NUMERADA dos cabeçalhos de cláusula (só o título de cada uma, não o corpo) de um contrato de locação, na ordem em que aparecem. Também recebe em que posição uma nova cláusula de garantia locatícia precisa ser inserida, e um rótulo pra ela.

Sua tarefa:
1. Identifique o estilo exato de numeração usado nos cabeçalhos (numérico com ou sem zero à esquerda, com símbolo de grau, ordinal por extenso, maiúsculas, pontuação depois do número, etc).
2. Gere o cabeçalho da nova cláusula de garantia, no MESMO estilo, com o número que cabe na posição indicada.
3. Para CADA cabeçalho que precisa ser renumerado por causa da inserção (todos que vêm depois da posição, +1 no número), devolva o texto ORIGINAL exato desse cabeçalho e o texto NOVO com o número atualizado. Não inclua cabeçalhos que não mudam.
4. Não invente cabeçalhos que não estão na lista recebida.

Responda sempre chamando a ferramenta "reportar_renumeracao".`;

const FERRAMENTA: Anthropic.Tool = {
  name: "reportar_renumeracao",
  description: "Reporta o cabeçalho da nova cláusula de garantia e a lista de cabeçalhos existentes que precisam ser renumerados.",
  input_schema: {
    type: "object",
    properties: {
      cabecalho_novo: {
        type: "string",
        minLength: 1,
        description: "Cabeçalho completo da nova cláusula de garantia, no mesmo estilo dos demais, com o número correto pra posição indicada.",
      },
      renumeracoes: {
        type: "array",
        description: "Lista de cabeçalhos existentes que mudam de número por causa da inserção, na ordem em que aparecem no documento.",
        items: {
          type: "object",
          properties: {
            original: { type: "string", description: "Texto exato do cabeçalho como está hoje na lista recebida." },
            novo: { type: "string", description: "Texto do cabeçalho com o número renumerado." },
          },
          required: ["original", "novo"],
        },
      },
    },
    required: ["cabecalho_novo", "renumeracoes"],
  },
};

async function planejarInsercao(
  cabecalhos: Cabecalho[],
  posicaoAposClausula: number,
  rotuloGarantia: string,
  anthropic: Anthropic
): Promise<{ cabecalhoNovo: string; renumeracoes: { original: string; novo: string }[] }> {
  const lista = cabecalhos.map((c, i) => `${i + 1}: ${c.linha.trim()}`).join("\n");

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: "reportar_renumeracao" },
    messages: [
      {
        role: "user",
        content: `CABEÇALHOS DO CONTRATO (só título, em ordem):\n\n${lista}\n\n---\n\nInserir a cláusula de garantia logo depois do item ${posicaoAposClausula} da lista (0 = antes do item 1; ou seja, ela vira o item ${posicaoAposClausula + 1}).\n\nRótulo da garantia: ${rotuloGarantia}`,
      },
    ],
  });

  if (mensagem.stop_reason === "max_tokens") {
    throw new Error("O planejamento da inserção foi cortado antes de terminar.");
  }

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou o plano de inserção.");
  }

  const resultado = chamada.input as { cabecalho_novo: string; renumeracoes: { original: string; novo: string }[] };
  return { cabecalhoNovo: resultado.cabecalho_novo, renumeracoes: resultado.renumeracoes ?? [] };
}

export async function inserirClausulaGarantiaNaPosicaoCorreta(
  textoBase: string,
  posicaoAposClausula: number | null,
  rotuloGarantia: string,
  corpoGarantia: string
): Promise<ResultadoInsercaoGarantia> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Inserção automática não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const blocoGarantia = `${rotuloGarantia}\n\n${corpoGarantia}`;
  const cabecalhos = extrairCabecalhos(textoBase);

  // Sem cláusulas numeradas detectadas, ou sem posição gravada: cai no
  // comportamento simples (cola no final com cabeçalho genérico).
  if (cabecalhos.length === 0 || posicaoAposClausula === null) {
    return { texto_final: [textoBase, `CLÁUSULA DE GARANTIA — ${blocoGarantia}`].join("\n\n") };
  }

  const anthropic = new Anthropic({ apiKey });
  const posicao = Math.min(posicaoAposClausula, cabecalhos.length);
  const { cabecalhoNovo, renumeracoes } = await planejarInsercao(cabecalhos, posicao, rotuloGarantia, anthropic);

  let linhas = textoBase.split("\n");

  // Descobre onde inserir ANTES de aplicar qualquer renumeração (usando o
  // texto original do cabeçalho que hoje ocupa essa posição).
  const linhaSeguinte = posicao < cabecalhos.length ? cabecalhos[posicao].linha : null;
  const indiceInsercao = linhaSeguinte !== null ? linhas.indexOf(linhaSeguinte) : linhas.length;

  // Renumera os cabeçalhos existentes (substituição exata de linha).
  for (const { original, novo } of renumeracoes) {
    const idx = linhas.indexOf(original);
    if (idx !== -1) linhas[idx] = novo;
  }

  const blocoNovasLinhas = ["", cabecalhoNovo, "", corpoGarantia, ""];
  if (indiceInsercao === -1 || indiceInsercao >= linhas.length) {
    linhas = [...linhas, ...blocoNovasLinhas];
  } else {
    linhas = [...linhas.slice(0, indiceInsercao), ...blocoNovasLinhas, ...linhas.slice(indiceInsercao)];
  }

  return { texto_final: linhas.join("\n") };
}
