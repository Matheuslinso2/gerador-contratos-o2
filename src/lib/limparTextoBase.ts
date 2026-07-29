import Anthropic from "@anthropic-ai/sdk";

export type ResultadoLimpeza = {
  texto_limpo: string;
  clausula_removida: boolean;
};

const SYSTEM_PROMPT = `Você recebe o texto-base de um contrato de locação que uma imobiliária cadastra como MODELO/TEMPLATE reutilizável no sistema. Esse texto-base é usado como ponto de partida para gerar cada contrato específico depois — e nesse momento posterior, o sistema anexa automaticamente a cláusula de garantia locatícia correta (fiador, caução, seguro-fiança ou título de capitalização) daquele contrato específico.

Por isso, o texto-base NÃO PODE conter nenhuma cláusula de garantia locatícia já embutida — senão o contrato final ficaria com a garantia duplicada (a que já veio no texto-base + a que o sistema anexa depois).

Sua tarefa:
1. Procure no texto uma ou mais cláusulas que tratem da GARANTIA DA LOCAÇÃO — ou seja, qualquer cláusula que estabeleça ou descreva a modalidade de garantia (fiador, caução/depósito caução, seguro-fiança locatícia, título de capitalização), incluindo textos de seguradora colados dentro dela (sub-itens numerados tipo "11.1", "11.2", ou blocos com numeração própria tipo "Cláusula 1 -", "Cláusula 2 -" referentes às condições do seguro).
2. Remova COMPLETAMENTE essa(s) cláusula(s) do texto, incluindo seu título e todo o conteúdo até o início da próxima cláusula do contrato principal.
3. RENUMERE as cláusulas restantes para que a sequência fique coerente, sem pular nem repetir número — respeitando EXATAMENTE o mesmo estilo de numeração já usado no resto do documento (ex: se o documento usa "CLÁUSULA 01", "CLÁUSULA 02"..., continue nesse formato; se usa "CLÁUSULA PRIMEIRA", "CLÁUSULA SEGUNDA"..., continue com ordinais por extenso; se usa "CLÁUSULA 1°-", mantenha o símbolo de grau). Não mude nenhum outro conteúdo do texto — só a numeração das cláusulas afetadas pela remoção.
4. Se o texto não tiver nenhuma cláusula de garantia (ex: já está limpo, ou é só um rascunho simples sem cláusulas numeradas), devolva o texto exatamente como veio, sem alterar nada, e marque clausula_removida como false.
5. NÃO remova cláusulas de seguro incêndio (isso é item separado, obrigatório à parte, não é garantia locatícia) nem cláusulas de multa rescisória, vistoria, ou qualquer outra coisa que não seja especificamente sobre qual modalidade de garantia locatícia foi contratada.

Responda sempre chamando a ferramenta "reportar_limpeza".`;

const FERRAMENTA: Anthropic.Tool = {
  name: "reportar_limpeza",
  description: "Reporta o texto-base do contrato após remover e renumerar a(s) cláusula(s) de garantia locatícia, se houver.",
  input_schema: {
    type: "object",
    properties: {
      clausula_removida: {
        type: "boolean",
        description: "true se alguma cláusula de garantia locatícia foi encontrada e removida; false se o texto já não tinha nenhuma.",
      },
      texto_limpo: {
        type: "string",
        minLength: 1,
        description: "O texto-base completo, sem a(s) cláusula(s) de garantia locatícia e com a numeração das cláusulas restantes corrigida. Se nada foi removido, é o texto original sem nenhuma alteração.",
      },
    },
    required: ["clausula_removida", "texto_limpo"],
  },
};

export async function limparClausulaGarantiaDoTextoBase(texto: string): Promise<ResultadoLimpeza> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Limpeza automática não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: "reportar_limpeza" },
    messages: [
      {
        role: "user",
        content: `Texto-base do contrato:\n\n${texto}`,
      },
    ],
  });

  if (mensagem.stop_reason === "max_tokens") {
    throw new Error(
      "O texto-base é grande demais e a limpeza automática foi cortada antes de terminar. Tente novamente."
    );
  }

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou o texto limpo.");
  }

  const resultado = chamada.input as ResultadoLimpeza;
  if (!resultado.texto_limpo?.trim()) {
    throw new Error("A limpeza automática retornou um texto vazio.");
  }

  return resultado;
}
