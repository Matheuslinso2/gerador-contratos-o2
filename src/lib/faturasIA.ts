import Anthropic from "@anthropic-ai/sdk";

// Schema achatado (sem objetos aninhados) — mesmo cuidado já tomado em
// prospeccaoIA.ts/auditorContrato.ts nesse projeto: schema aninhado
// confundiu o modelo em versões anteriores.
export type DadosFaturaExtraidos = {
  seguradora: string | null;
  codigo_produtor: string | null;
  competencia: string | null; // "AAAA-MM", se identificável no documento
  vencimento: string | null; // "AAAA-MM-DD"
  valor: number | null;
  numero_documento: string | null;
  identificacao_texto: string | null; // razão social / nome fantasia / CNPJ como aparecem no boleto
};

const SYSTEM_PROMPT = `Você extrai dados estruturados de um boleto/fatura de seguradora que a O2 Seguros (corretora) precisa repassar para a imobiliária correspondente.

Você vai receber o texto extraído de um PDF de fatura. Extraia SOMENTE o que estiver realmente presente no texto — nunca invente ou deduza um valor que não apareça. Se um campo não for identificável, retorne null para ele.

Preencha:
- seguradora: nome da seguradora emissora do boleto (ex: "Porto Seguro", "Tokio Marine", "Pottencial").
- codigo_produtor: código de produtor/corretor mencionado no documento, se houver.
- competencia: mês de referência do boleto/fatura, no formato "AAAA-MM", se identificável (pode ser diferente do mês de vencimento).
- vencimento: data de vencimento do boleto, no formato "AAAA-MM-DD".
- valor: valor total do boleto, como número (ex: 1234.56), sem símbolo de moeda.
- numero_documento: número/identificador do boleto ou da apólice, se houver.
- identificacao_texto: como a imobiliária/tomador aparece no documento — razão social, nome fantasia e/ou CNPJ, tudo que ajudar a identificar de qual imobiliária é essa fatura (mesmo que o CNPJ já tenha sido usado pra abrir o arquivo).

Responda SEMPRE chamando a ferramenta "extrair_fatura". Nunca responda em texto livre.`;

const FERRAMENTA_EXTRACAO: Anthropic.Tool = {
  name: "extrair_fatura",
  description: "Reporta os dados estruturados extraídos de uma fatura/boleto de seguradora.",
  input_schema: {
    type: "object",
    properties: {
      seguradora: { type: ["string", "null"], description: "Nome da seguradora emissora." },
      codigo_produtor: { type: ["string", "null"], description: "Código de produtor/corretor, se houver." },
      competencia: { type: ["string", "null"], description: "Mês de referência, formato AAAA-MM." },
      vencimento: { type: ["string", "null"], description: "Data de vencimento, formato AAAA-MM-DD." },
      valor: { type: ["number", "null"], description: "Valor total do boleto." },
      numero_documento: { type: ["string", "null"], description: "Número do boleto/apólice, se houver." },
      identificacao_texto: {
        type: ["string", "null"],
        description: "Razão social, nome fantasia e/ou CNPJ da imobiliária/tomador como aparecem no documento.",
      },
    },
    required: [
      "seguradora",
      "codigo_produtor",
      "competencia",
      "vencimento",
      "valor",
      "numero_documento",
      "identificacao_texto",
    ],
  },
};

export async function extrairDadosFatura(textoFatura: string): Promise<DadosFaturaExtraidos> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Extração de faturas não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_EXTRACAO],
    tool_choice: { type: "tool", name: "extrair_fatura" },
    messages: [{ role: "user", content: `TEXTO EXTRAÍDO DA FATURA:\n\n${textoFatura}` }],
  });

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou dados estruturados da fatura.");
  }

  return chamada.input as DadosFaturaExtraidos;
}
