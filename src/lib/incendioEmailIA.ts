import Anthropic from "@anthropic-ai/sdk";

// Schema achatado -- mesmo cuidado já documentado em auditorContrato.ts e
// faturasIA.ts nesse projeto (schema aninhado confunde o modelo).
export type DadosEmailIncendioExtraidos = {
  tipo_confirmacao: "contratacao_confirmada" | "apolice_emitida" | "cancelamento_confirmado" | "outro" | "nao_identificado";
  seguradora: string | null;
  cliente_nome: string | null;
  ramo: string | null;
  numero_apolice: string | null;
  valor: number | null;
};

const SYSTEM_PROMPT = `Você analisa e-mails recebidos na caixa incendio@o2seguros.com.br da O2 Seguros (corretora), pra identificar e extrair confirmações de status de negociações de RAMOS ELEMENTARES, EXCLUSIVAMENTE os produtos: Incêndio Individual Residencial, Incêndio Individual Empresarial, Incêndio Imobiliário, Equipamentos Portáteis e Seguro Condominial.

IMPORTANTE: essa mesma caixa de e-mail também recebe mensagens sobre OUTROS produtos que a O2 vende (Seguro Fiança Locatícia, Título de Capitalização, Auto, Moto, Vida, etc.) -- esses NÃO são Ramos Elementares e devem ser classificados como "nao_identificado", mesmo que o e-mail seja claramente uma confirmação de contratação/apólice/cancelamento de um desses outros produtos. Só classifique como contratacao_confirmada/apolice_emitida/cancelamento_confirmado/outro quando o produto do e-mail for claramente um dos 5 ramos elementares listados acima.

Essa caixa recebe MUITOS tipos de e-mail diferentes (cobrança, renovação, sinistro, spam, produtos de outras áreas, etc.) -- sua primeira tarefa é classificar corretamente tipo_confirmacao:

- "contratacao_confirmada": um e-mail INTERNO da O2 (geralmente de alguém @o2seguros.com.br) confirmando que a contratação de um seguro foi realizada. Costuma ter frases como "CONTRATAÇÃO CONFIRMADA" ou "CONFIRMAÇÃO DE CONTRATAÇÃO" no assunto/corpo, e cita seguro, cliente, seguradora.
- "apolice_emitida": confirma que a apólice foi EMITIDA/gerada (seja um e-mail interno da O2 dizendo "APÓLICE EMITIDA", seja um e-mail AUTOMÁTICO da própria seguradora tipo "Apólice Digital", "Cartão e Documentos Digitais", parabenizando o cliente pela contratação).
- "cancelamento_confirmado": confirma que uma apólice/seguro foi CANCELADO. Costuma ter "CANCELAMENTO CONFIRMADO" no corpo.
- "outro": é claramente sobre uma negociação/apólice de incêndio ou ramos elementares, mas não se encaixa nos 3 tipos acima (ex: pedido de cancelamento ainda não confirmado, dúvida, solicitação de documentos de sinistro).
- "nao_identificado": não é sobre confirmação de status de negociação/contratação (ex: cobrança/ficha de compensação, lembrete de renovação futura, spam, assunto totalmente não relacionado). Use esse valor pra qualquer e-mail que não seja claramente uma dessas confirmações -- é preferível classificar como "nao_identificado" a forçar um encaixe errado.

Se tipo_confirmacao for "nao_identificado", deixe os demais campos como null.

Para os outros tipos, extraia (só o que estiver realmente presente no texto -- nunca invente):
- seguradora: nome da seguradora (ex: "Tokio Marine", "Porto Seguro", "Allianz", "Suhai").
- cliente_nome: nome do segurado/cliente/locatário mencionado.
- ramo: tipo de seguro (ex: "Incêndio Residencial", "Incêndio Empresarial", "Condomínio", "Moto", "Auto") se identificável.
- numero_apolice: número da apólice, se mencionado.
- valor: valor do prêmio/parcela mencionado, como número, se houver.

Responda SEMPRE chamando a ferramenta "extrair_confirmacao_incendio". Nunca responda em texto livre.`;

const FERRAMENTA_EXTRACAO: Anthropic.Tool = {
  name: "extrair_confirmacao_incendio",
  description: "Reporta a classificação e os dados estruturados extraídos de um e-mail da caixa incendio@o2seguros.com.br.",
  input_schema: {
    type: "object",
    properties: {
      tipo_confirmacao: {
        type: "string",
        enum: ["contratacao_confirmada", "apolice_emitida", "cancelamento_confirmado", "outro", "nao_identificado"],
        description: "Classificação do e-mail.",
      },
      seguradora: { type: ["string", "null"], description: "Nome da seguradora." },
      cliente_nome: { type: ["string", "null"], description: "Nome do segurado/cliente." },
      ramo: { type: ["string", "null"], description: "Tipo de seguro/ramo." },
      numero_apolice: { type: ["string", "null"], description: "Número da apólice, se mencionado." },
      valor: { type: ["number", "null"], description: "Valor do prêmio/parcela mencionado." },
    },
    required: ["tipo_confirmacao", "seguradora", "cliente_nome", "ramo", "numero_apolice", "valor"],
  },
};

export async function extrairDadosEmailIncendio(
  assunto: string,
  corpo: string,
  remetente: string
): Promise<DadosEmailIncendioExtraidos> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Extração de e-mails de incêndio não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_EXTRACAO],
    tool_choice: { type: "tool", name: "extrair_confirmacao_incendio" },
    messages: [
      {
        role: "user",
        content: `REMETENTE: ${remetente}\nASSUNTO: ${assunto}\n\nCORPO DO E-MAIL:\n\n${corpo}`,
      },
    ],
  });

  const chamada = mensagem.content.find((bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use");
  if (!chamada) {
    throw new Error("A IA não retornou uma classificação estruturada do e-mail.");
  }

  return chamada.input as DadosEmailIncendioExtraidos;
}
