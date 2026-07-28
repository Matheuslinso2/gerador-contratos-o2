import Anthropic from "@anthropic-ai/sdk";

export type DadosTituloCapitalizacao = {
  valor_titulo: number;
  numero_proposta: string;
};

const SYSTEM_PROMPT = `Você recebe o texto de uma proposta/ficha de cadastro de Título de Capitalização usado como garantia locatícia (ex: Brasilcap). Extraia exatamente dois dados, sempre chamando a ferramenta "reportar_dados_titulo":

1. valor_titulo: o valor nominal/valor da garantia do título (o campo costuma se chamar "Valor da Garantia", "Capital" ou "Valor do Título"). Retorne só o número, sem "R$" e sem separador de milhar, usando ponto como separador decimal (ex: 30010.00).
2. numero_proposta: o número que identifica esta garantia (o campo costuma se chamar "Número da Notificação de Garantia"). Se esse campo específico não existir, use o "Nº de Identificação da Venda" ou o número de proposta mais próximo disso.

Esses dois campos são obrigatórios e nunca podem ficar vazios quando a informação existir no texto.`;

const FERRAMENTA: Anthropic.Tool = {
  name: "reportar_dados_titulo",
  description: "Reporta o valor nominal e o número da proposta/garantia identificados na proposta de título de capitalização.",
  input_schema: {
    type: "object",
    properties: {
      valor_titulo: {
        type: "number",
        description: "Valor nominal/valor da garantia do título, só número (ex: 30010.00).",
      },
      numero_proposta: {
        type: "string",
        minLength: 1,
        description: "Número que identifica a garantia/proposta (ex: número da notificação de garantia).",
      },
    },
    required: ["valor_titulo", "numero_proposta"],
  },
};

export async function extrairDadosTitulo(textoProposta: string): Promise<DadosTituloCapitalizacao> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Extração de dados do título de capitalização não configurada: falta a variável de ambiente ANTHROPIC_API_KEY."
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: "reportar_dados_titulo" },
    messages: [
      {
        role: "user",
        content: `Documento da proposta de título de capitalização:\n\n${textoProposta}`,
      },
    ],
  });

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou os dados do título de capitalização.");
  }

  return chamada.input as DadosTituloCapitalizacao;
}
