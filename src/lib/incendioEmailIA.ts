import Anthropic from "@anthropic-ai/sdk";

// Schema achatado -- mesmo cuidado já documentado em auditorContrato.ts e
// faturasIA.ts nesse projeto (schema aninhado confunde o modelo).
export type DadosEmailIncendioExtraidos = {
  tipo_confirmacao:
    | "contratacao_confirmada"
    | "apolice_emitida"
    | "cancelamento_confirmado"
    | "autorizacao_cliente"
    | "outro"
    | "nao_identificado";
  seguradora: string | null;
  cliente_nome: string | null;
  ramo: string | null;
  numero_apolice: string | null;
  valor: number | null;
  e_lote: boolean;
};

const SYSTEM_PROMPT = `Você analisa e-mails recebidos na caixa incendio@o2seguros.com.br da O2 Seguros (corretora), pra identificar e extrair confirmações de status de negociações de RAMOS ELEMENTARES, EXCLUSIVAMENTE os produtos: Incêndio Individual Residencial, Incêndio Individual Empresarial, Incêndio Imobiliário, Equipamentos Portáteis e Seguro Condominial.

IMPORTANTE: essa mesma caixa de e-mail também recebe mensagens sobre OUTROS produtos que a O2 vende (Seguro Fiança Locatícia, Título de Capitalização, Auto, Moto, Vida, etc.) -- esses NÃO são Ramos Elementares e devem ser classificados como "nao_identificado", mesmo que o e-mail seja claramente uma confirmação de contratação/apólice/cancelamento de um desses outros produtos. Só classifique como contratacao_confirmada/apolice_emitida/cancelamento_confirmado/outro quando o produto do e-mail for claramente um dos 5 ramos elementares listados acima.

Essa caixa recebe MUITOS tipos de e-mail diferentes (cobrança, renovação, sinistro, spam, produtos de outras áreas, etc.) -- sua primeira tarefa é classificar corretamente tipo_confirmacao. Preste atenção em QUEM manda cada tipo: os 3 primeiros tipos abaixo são sempre um e-mail da PRÓPRIA O2 (ou automático da seguradora) dizendo que algo foi feito; "autorizacao_cliente" é o INVERSO -- é a imobiliária/cliente dando o aval pra O2 seguir, ANTES da O2 confirmar:

- "contratacao_confirmada": um e-mail INTERNO da O2 (geralmente de alguém @o2seguros.com.br) confirmando que a contratação de um seguro foi realizada. Costuma ter frases como "CONTRATAÇÃO CONFIRMADA" ou "CONFIRMAÇÃO DE CONTRATAÇÃO" no assunto/corpo, e cita seguro, cliente, seguradora.
- "apolice_emitida": confirma que a apólice foi EMITIDA/gerada (seja um e-mail interno da O2 dizendo "APÓLICE EMITIDA", seja um e-mail AUTOMÁTICO da própria seguradora tipo "Apólice Digital", "Cartão e Documentos Digitais", parabenizando o cliente pela contratação).
- "cancelamento_confirmado": confirma que uma apólice/seguro foi CANCELADO. Costuma ter "CANCELAMENTO CONFIRMADO" no corpo.
- "autorizacao_cliente": um e-mail EXTERNO (da imobiliária/administradora/cliente, NÃO de @o2seguros.com.br) autorizando a O2 a seguir com a contratação, renovação ou cancelamento -- é o aval do cliente, mas ainda NÃO é a confirmação de que a O2 já fez. Exemplos reais: "Pode seguir com a contratação", "Podem renovar", "De acordo, pode prosseguir", "Todos os seguros serão renovados, exceto o de Fulano de Tal". NÃO classifique como isso uma simples dúvida ou pedido inicial de cotação -- é especificamente um "sim, pode ir em frente" depois de já terem recebido uma proposta/cotação.
- "outro": é claramente sobre uma negociação/apólice de incêndio ou ramos elementares, mas não se encaixa nos tipos acima (ex: pedido de cancelamento ainda não confirmado, dúvida, solicitação de documentos de sinistro, e-mail de acompanhamento tipo "recebemos sua solicitação, entraremos em contato").
- "nao_identificado": não é sobre confirmação de status de negociação/contratação (ex: cobrança/ficha de compensação, lembrete de renovação futura, spam, assunto totalmente não relacionado). Use esse valor pra qualquer e-mail que não seja claramente uma dessas confirmações -- é preferível classificar como "nao_identificado" a forçar um encaixe errado.

Se tipo_confirmacao for "nao_identificado", deixe os demais campos como null.

Para os outros tipos, extraia (só o que estiver realmente presente no texto -- nunca invente):
- seguradora: nome da seguradora (ex: "Tokio Marine", "Porto Seguro", "Allianz", "Suhai").
- cliente_nome: nome do segurado/cliente/locatário mencionado.
- ramo: tipo de seguro (ex: "Incêndio Residencial", "Incêndio Empresarial", "Condomínio", "Moto", "Auto") se identificável.
- numero_apolice: número da apólice, se mencionado.
- valor: valor do prêmio/parcela mencionado, como número, se houver.
- e_lote: true quando o e-mail trata de VÁRIAS apólices/clientes de uma vez (ex: renovação em lote de uma imobiliária inteira, com uma planilha anexa listando vários itens, tipo "15 itens, 12 contratados"). Nesses casos ainda descreva o lote em cliente_nome (ex: "Renovação Canale Imóveis — 15 itens"), mas marque e_lote como true -- um lote inteiro não pode ser cruzado com uma única linha da planilha, então não adianta tentar. Se o e-mail trata de um único cliente/apólice, e_lote é false.

Responda SEMPRE chamando a ferramenta "extrair_confirmacao_incendio". Nunca responda em texto livre.`;

const FERRAMENTA_EXTRACAO: Anthropic.Tool = {
  name: "extrair_confirmacao_incendio",
  description: "Reporta a classificação e os dados estruturados extraídos de um e-mail da caixa incendio@o2seguros.com.br.",
  input_schema: {
    type: "object",
    properties: {
      tipo_confirmacao: {
        type: "string",
        enum: ["contratacao_confirmada", "apolice_emitida", "cancelamento_confirmado", "autorizacao_cliente", "outro", "nao_identificado"],
        description: "Classificação do e-mail.",
      },
      seguradora: { type: ["string", "null"], description: "Nome da seguradora." },
      cliente_nome: { type: ["string", "null"], description: "Nome do segurado/cliente." },
      ramo: { type: ["string", "null"], description: "Tipo de seguro/ramo." },
      numero_apolice: { type: ["string", "null"], description: "Número da apólice, se mencionado." },
      valor: { type: ["number", "null"], description: "Valor do prêmio/parcela mencionado." },
      e_lote: {
        type: "boolean",
        description: "true quando o e-mail trata de várias apólices/clientes de uma vez (lote), false quando é um único cliente/apólice.",
      },
    },
    required: ["tipo_confirmacao", "seguradora", "cliente_nome", "ramo", "numero_apolice", "valor", "e_lote"],
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
