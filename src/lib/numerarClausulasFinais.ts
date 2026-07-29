import Anthropic from "@anthropic-ai/sdk";

export type ResultadoInsercaoGarantia = {
  texto_final: string;
};

const SYSTEM_PROMPT = `Você recebe o texto-base de um contrato de locação (já sem nenhuma cláusula de garantia, pois ela foi removida antes) e o texto pronto de uma cláusula de garantia locatícia para inserir de volta numa posição exata.

REGRAS IMPORTANTES:
1. NUNCA altere, resuma, parafraseie ou reescreva o conteúdo de nenhuma cláusula já existente no texto-base — reproduza cada uma delas exatamente como veio, palavra por palavra.
2. NUNCA altere o texto da cláusula de garantia fornecida — cole exatamente como veio, palavra por palavra, só ajustando o número do cabeçalho dela pra se encaixar na sequência.
3. Você vai receber a instrução exata de onde inserir (depois de quantas cláusulas). Se o texto-base tem cláusulas numeradas (ex: "CLÁUSULA 01 -", "CLÁUSULA 1°-", "CLÁUSULA PRIMEIRA –"), identifique o estilo exato de numeração usado e:
   a. Insira a cláusula de garantia logo depois da cláusula na posição indicada (se a instrução for "depois de 0 cláusulas", ela vira a primeira cláusula do contrato).
   b. Dê a ela o número que caberia nessa posição, no MESMO estilo de numeração do resto do documento.
   c. RENUMERE sequencialmente (+1) todas as cláusulas que ficam depois dela, mantendo intactos o texto e a ordem de cada uma — só o número do cabeçalho muda.
   d. Se alguma cláusula citar o número de outra por referência cruzada (ex: "conforme cláusula 18"), atualize esse número também para continuar apontando pra cláusula certa depois da renumeração.
4. Se o texto-base NÃO tem nenhuma cláusula numerada (texto livre, sem esse padrão), ignore a posição indicada e apenas acrescente a cláusula de garantia ao final do texto, com um cabeçalho genérico "CLÁUSULA DE GARANTIA — [descrição]".
5. Devolva o texto-base INTEIRO (todas as cláusulas, do início ao fim) com a cláusula de garantia já inserida — não devolva só um trecho.

Responda sempre chamando a ferramenta "reportar_texto_final".`;

const FERRAMENTA: Anthropic.Tool = {
  name: "reportar_texto_final",
  description: "Reporta o contrato completo, com a cláusula de garantia inserida na posição indicada e a numeração ajustada.",
  input_schema: {
    type: "object",
    properties: {
      texto_final: {
        type: "string",
        minLength: 1,
        description: "O contrato completo (texto-base inteiro + cláusula de garantia inserida na posição indicada, com numeração ajustada).",
      },
    },
    required: ["texto_final"],
  },
};

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

  const anthropic = new Anthropic({ apiKey });

  const instrucaoPosicao =
    posicaoAposClausula === null
      ? "Este contrato não tem cláusulas numeradas identificadas — só acrescente a cláusula de garantia ao final, com cabeçalho genérico."
      : `Insira a cláusula de garantia logo depois da ${posicaoAposClausula}ª cláusula numerada do texto-base (ou seja, depois de ${posicaoAposClausula} cláusulas). Se ${posicaoAposClausula} for 0, ela vira a primeira cláusula do contrato.`;

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: "reportar_texto_final" },
    messages: [
      {
        role: "user",
        content: `TEXTO-BASE DO CONTRATO (sem a cláusula de garantia):\n\n${textoBase}\n\n---\n\nONDE INSERIR: ${instrucaoPosicao}\n\n---\n\nCLÁUSULA DE GARANTIA A INSERIR (rótulo sugerido pro cabeçalho, ajuste o número conforme a posição: "${rotuloGarantia}"):\n\n${corpoGarantia}`,
      },
    ],
  });

  if (mensagem.stop_reason === "max_tokens") {
    throw new Error("A inserção da cláusula de garantia foi cortada antes de terminar — contrato muito grande.");
  }

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou o contrato com a cláusula inserida.");
  }

  const resultado = chamada.input as ResultadoInsercaoGarantia;
  if (!resultado.texto_final?.trim()) {
    throw new Error("A inserção automática retornou um texto vazio.");
  }

  return resultado;
}
