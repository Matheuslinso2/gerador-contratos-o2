import Anthropic from "@anthropic-ai/sdk";

export type ResultadoPreparo = {
  texto_preparado: string;
  clausula_garantia_removida: boolean;
  clausulas_antes_da_garantia_removida: number | null;
};

const SYSTEM_PROMPT = `Você recebe o texto-base de um contrato de locação que uma imobiliária cadastra como MODELO/TEMPLATE reutilizável no sistema. Esse texto-base é usado como ponto de partida pra gerar cada contrato específico depois, preenchendo automaticamente os dados daquela locação (partes, imóvel, valores, datas) e anexando a cláusula de garantia correta.

Às vezes a imobiliária cola um contrato REAL já finalizado (com nomes, endereço, valores e datas de uma locação específica) em vez de um modelo genérico. Sua tarefa é transformar esse texto num modelo reutilizável de verdade, substituindo os dados específicos por marcadores — sem alterar mais nada.

TAREFA 1 — MARCADORES DE DADOS VARIÁVEIS:
Procure, em QUALQUER lugar do texto (inclusive dentro de cláusulas como "DAS PARTES", "DO OBJETO", "DO PRAZO", "DO ALUGUEL"), menções aos dados específicos desta locação e substitua pelos marcadores abaixo. Troque só o trecho com o dado em si (nome, endereço, valor, data), mantendo o resto da frase/cláusula exatamente como está:
- Nome(s) e qualificação completa do(s) LOCADOR(ES) (nome, nacionalidade, estado civil, profissão, RG, CPF, endereço pessoal, e-mail se houver) → {{locador}}
- Nome(s) e qualificação completa do(s) LOCATÁRIO(S) → {{locatario}}
- Endereço do imóvel objeto da locação (o que está sendo alugado, não o endereço pessoal das partes) → {{endereco_imovel}}
- Valor do aluguel mensal → {{valor_aluguel}}
- Data de início da locação → {{data_inicio}}
- Data de término/fim da locação → {{data_termino}}
- Prazo da locação em meses (só o número, ex: "30") → {{prazo_meses}}
- Dia do mês de vencimento do aluguel (só o número, ex: "10") → {{dia_vencimento}}
Se algum desses dados não aparecer em lugar nenhum do texto, não crie o marcador — só troque o que realmente encontrar.
NÃO troque nomes/dados que apareçam em rodapé, cabeçalho ou local de assinatura de forma genérica (ex: "LOCADOR(ES)" sozinho como rótulo de assinatura, sem o nome, fica como está).
NÃO mexa em dados da IMOBILIÁRIA (nome, CNPJ, CRECI dela) nem de terceiros como testemunhas, fiador, procurador — só locador, locatário, imóvel, valores e datas da locação em si.

ATENÇÃO — NÚMERO REPETIDO POR EXTENSO: contratos costumam repetir o valor do aluguel ou o prazo por extenso entre parênteses logo depois do número/valor (ex: "30 (trinta) meses", "R$ 3.500,00 (três mil e quinhentos reais)"). Nesses casos, troque o par INTEIRO (número + parênteses) pelos DOIS marcadores juntos, no mesmo formato:
- "30 (trinta) meses" → "{{prazo_meses}} ({{prazo_meses_extenso}}) meses"
- "R$ 3.500,00 (três mil e quinhentos reais)" → "{{valor_aluguel}} ({{valor_aluguel_extenso}})"
Nunca deixe um número por extenso entre parênteses sem o marcador correspondente — ele ficaria incoerente quando o valor mudar (ex: "24 (trinta) meses" seria um erro grave).

TAREFA 2 — CLÁUSULA DE GARANTIA:
O texto-base NÃO PODE conter nenhuma cláusula de garantia locatícia já embutida (fiador, caução, seguro-fiança, título de capitalização) — o sistema anexa essa cláusula automaticamente depois, escolhida pra cada contrato específico. Se houver duplicaria a garantia.
1. Procure uma ou mais cláusulas que tratem da GARANTIA DA LOCAÇÃO, incluindo textos de seguradora colados dentro dela (sub-itens numerados tipo "11.1", "11.2", ou blocos com numeração própria tipo "Cláusula 1 -", "Cláusula 2 -").
2. Antes de remover, conte quantas cláusulas numeradas do contrato PRINCIPAL vêm ANTES dela (ex: se ela é a "CLÁUSULA 11" de um contrato numerado normalmente a partir de 1, a resposta é 10). Essa contagem é usada depois pra reinserir a cláusula de garantia na mesma posição.
3. Remova COMPLETAMENTE essa(s) cláusula(s), incluindo título e conteúdo, até o início da próxima cláusula do contrato principal.
4. RENUMERE as cláusulas restantes pra sequência ficar coerente, respeitando EXATAMENTE o estilo de numeração já usado (numérico, com grau, ordinal por extenso, etc).
5. Se não houver cláusula de garantia, marque clausula_garantia_removida como false e clausulas_antes_da_garantia_removida como null.
6. NÃO remova cláusulas de seguro incêndio, multa rescisória, vistoria ou qualquer outra coisa que não seja especificamente sobre qual modalidade de garantia locatícia foi contratada.

Não altere nenhum outro conteúdo do texto além do que as duas tarefas acima pedem.

Responda sempre chamando a ferramenta "reportar_preparo".`;

const FERRAMENTA: Anthropic.Tool = {
  name: "reportar_preparo",
  description: "Reporta o texto-base do contrato após inserir os marcadores de dados variáveis e remover/renumerar a cláusula de garantia locatícia, se houver.",
  input_schema: {
    type: "object",
    properties: {
      clausula_garantia_removida: {
        type: "boolean",
        description: "true se alguma cláusula de garantia locatícia foi encontrada e removida; false se o texto já não tinha nenhuma.",
      },
      clausulas_antes_da_garantia_removida: {
        type: ["number", "null"],
        description: "Quantas cláusulas numeradas do contrato principal vinham antes da cláusula de garantia removida (0 se ela era a primeira). null se clausula_garantia_removida for false ou o texto não tinha cláusulas numeradas.",
      },
      texto_preparado: {
        type: "string",
        minLength: 1,
        description: "O texto-base completo, com os marcadores de dados variáveis inseridos no lugar dos dados específicos encontrados, sem a(s) cláusula(s) de garantia locatícia e com a numeração das cláusulas restantes corrigida.",
      },
    },
    required: ["clausula_garantia_removida", "clausulas_antes_da_garantia_removida", "texto_preparado"],
  },
};

export async function prepararTextoBase(texto: string): Promise<ResultadoPreparo> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Preparo automático não configurado: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: "reportar_preparo" },
    messages: [
      {
        role: "user",
        content: `Texto-base do contrato:\n\n${texto}`,
      },
    ],
  });

  if (mensagem.stop_reason === "max_tokens") {
    throw new Error(
      "O texto-base é grande demais e o preparo automático foi cortado antes de terminar. Tente novamente."
    );
  }

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou o texto preparado.");
  }

  const resultado = chamada.input as ResultadoPreparo;
  if (!resultado.texto_preparado?.trim()) {
    throw new Error("O preparo automático retornou um texto vazio.");
  }

  return resultado;
}
