import Anthropic from "@anthropic-ai/sdk";

// Schema achatado (sem objetos aninhados repetidos) — mesmo cuidado do
// auditorContrato.ts, onde um schema com blocos repetidos confundiu o
// modelo e ele parou de preencher no meio.
export type FichaImobiliaria = {
  porte_estimado: string;
  presenca_digital_resumo: string;
  publico_alvo_estimado: string;
  pontos_de_abordagem: string[];
  resumo_geral: string;
};

const SYSTEM_PROMPT = `Você ajuda um colaborador da O2 Seguros (corretora de seguros que atende imobiliárias, oferecendo seguro fiança e seguro incêndio para contratos de locação) a se preparar para uma visita comercial a uma imobiliária que ainda NÃO é parceira.

Você vai receber: (1) texto extraído do site e/ou Instagram da imobiliária, se o colaborador informou algum link (pode vir vazio ou incompleto — sites e Instagram às vezes bloqueiam a leitura automática); (2) notas manuais que o colaborador já digitou sobre o que sabe da imobiliária (pode vir vazio).

Sua tarefa é montar uma "ficha" curta e prática para orientar a conversa comercial, baseada SOMENTE no que foi fornecido. NUNCA invente informações que não estejam no texto/notas recebidos — se a informação disponível for pouca, diga isso explicitamente nos campos (ex: "Não foi possível identificar o porte a partir do material disponível.") em vez de supor.

Preencha:
- porte_estimado: uma frase sobre o porte aparente da imobiliária (pequena/média/grande, quantidade de imóveis anunciados se isso aparecer no material, etc.) ou uma frase dizendo que não dá para estimar com o material disponível.
- presenca_digital_resumo: uma frase sobre a presença digital dela (site, redes sociais, atividade aparente).
- publico_alvo_estimado: uma frase sobre o público/segmento que ela parece atender (residencial, comercial, alto padrão, popular, região de atuação etc.), se identificável.
- pontos_de_abordagem: lista curta (2 a 4 itens) de sugestões práticas de abordagem/conversa para a visita, considerando o que se sabe dela — pode incluir ganchos genéricos de venda de seguro fiança/incêndio quando não houver informação específica suficiente.
- resumo_geral: 2 a 3 frases resumindo o essencial para o colaborador ler rapidamente antes de entrar na reunião.

Responda SEMPRE chamando a ferramenta "montar_ficha". Nunca responda em texto livre.`;

const FERRAMENTA_FICHA: Anthropic.Tool = {
  name: "montar_ficha",
  description: "Reporta a ficha de preparação de visita comercial para uma imobiliária prospect.",
  input_schema: {
    type: "object",
    properties: {
      porte_estimado: { type: "string", minLength: 1, description: "Porte estimado da imobiliária, uma frase." },
      presenca_digital_resumo: { type: "string", minLength: 1, description: "Resumo da presença digital, uma frase." },
      publico_alvo_estimado: { type: "string", minLength: 1, description: "Público/segmento estimado, uma frase." },
      pontos_de_abordagem: {
        type: "array",
        description: "2 a 4 sugestões curtas e práticas de abordagem para a visita.",
        items: { type: "string" },
      },
      resumo_geral: { type: "string", minLength: 1, description: "Resumo geral em 2 a 3 frases." },
    },
    required: ["porte_estimado", "presenca_digital_resumo", "publico_alvo_estimado", "pontos_de_abordagem", "resumo_geral"],
  },
};

export async function montarFichaImobiliaria(
  nomeImobiliaria: string,
  cnpjImobiliaria: string,
  notasManuais: string,
  textoSite: string = "",
  textoInstagram: string = ""
): Promise<FichaImobiliaria> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Ferramenta de prospecção não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });

  const partes = [
    `IMOBILIÁRIA: ${nomeImobiliaria}${cnpjImobiliaria ? ` (CNPJ: ${cnpjImobiliaria})` : ""}`,
    `TEXTO EXTRAÍDO DO SITE: ${textoSite.trim() || "(nenhum site informado ou não foi possível extrair conteúdo)"}`,
    `TEXTO EXTRAÍDO DO INSTAGRAM: ${textoInstagram.trim() || "(nenhum Instagram informado ou não foi possível extrair conteúdo)"}`,
    `NOTAS MANUAIS DO COLABORADOR: ${notasManuais.trim() || "(nenhuma nota informada)"}`,
  ];

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_FICHA],
    tool_choice: { type: "tool", name: "montar_ficha" },
    messages: [{ role: "user", content: partes.join("\n\n") }],
  });

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou uma ficha estruturada.");
  }

  return chamada.input as FichaImobiliaria;
}
