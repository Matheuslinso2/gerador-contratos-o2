import Anthropic from "@anthropic-ai/sdk";

// Schema achatado (sem objetos aninhados) — mesmo cuidado já tomado em
// auditorContrato.ts nesse projeto: schema aninhado confundiu o modelo em
// versões anteriores.
export type DadosFaturaExtraidos = {
  seguradora: string | null;
  tipo_documento: "boleto" | "demonstrativo" | null;
  codigo_produtor: string | null;
  competencia: string | null; // "AAAA-MM", se identificável no documento
  vencimento: string | null; // "AAAA-MM-DD"
  valor: number | null;
  numero_documento: string | null;
  cnpj_tomador: string | null; // CNPJ ou CPF da imobiliária/tomador, se aparecer explicitamente no documento
  identificacao_texto: string | null; // razão social / nome fantasia como aparecem no boleto
};

// Conhecimento acumulado sobre particularidades de cada seguradora -- vira
// um parágrafo extra no prompt quando a seguradora já é sabida de antemão
// (o usuário escolhe no upload, ou já está gravada na fatura em caso de
// reprocessamento), pra guiar a extração em vez da IA adivinhar do zero em
// cada arquivo. Preenchido aos poucos conforme confirmado com a O2 --
// seguradora sem entrada aqui não ganha dica nenhuma além do prompt geral.
const PERFIS_SEGURADORAS: Record<string, string> = {
  TOKIO: `Particularidade conhecida da TOKIO: os documentos dela (principalmente o demonstrativo, que costuma vir em CSV) geralmente NÃO trazem o nome nem o CNPJ da imobiliária em lugar nenhum do conteúdo -- só o nome do inquilino/segurado em cada linha. Nesse caso, o NOME DO ARQUIVO (informado abaixo, se houver) é a fonte de identificação: a O2 salva esses arquivos já renomeados com o nome da imobiliária (ex: "RELATÓRIO NOME DA IMOBILIÁRIA.csv", "BOLETO NOME DA IMOBILIÁRIA.pdf"). Se o texto do documento não trouxer identificacao_texto nem cnpj_tomador, use o nome do arquivo (tirando palavras como BOLETO/RELATÓRIO/DEMONSTRATIVO do início e a extensão do final) como identificacao_texto.`,
};

const SYSTEM_PROMPT_BASE = `Você extrai dados estruturados de um boleto/fatura de seguradora que a O2 Seguros (corretora) precisa repassar para a imobiliária correspondente.

Você vai receber o nome do arquivo (quando disponível) e o texto extraído de um PDF/planilha de fatura. Extraia SOMENTE o que estiver realmente presente nesse material — nunca invente ou deduza um valor que não apareça. Se um campo não for identificável, retorne null para ele.

Algumas seguradoras mandam a cobrança em 2 arquivos separados por mês, pra mesma imobiliária: um BOLETO (o instrumento de pagamento em si -- tem linha digitável/código de barras, "ficha de compensação", um valor único a pagar) e um DEMONSTRATIVO/RELATÓRIO (lista/detalha as apólices ou inquilinos cobrados naquele boleto, pode ter várias linhas e um total, mas não é ele mesmo pagável). Você pode receber qualquer um dos dois.

Preencha:
- seguradora: nome da seguradora emissora (ex: "Porto Seguro", "Tokio Marine", "Pottencial").
- tipo_documento: "boleto" se o documento for o instrumento de pagamento (linha digitável, código de barras, ficha de compensação, "sacado", valor a pagar); "demonstrativo" se for uma lista/relatório detalhando apólices ou inquilinos (mesmo que tenha um total no fim). Se não conseguir distinguir, retorne null.
- codigo_produtor: código de produtor/corretor mencionado no documento, se houver.
- competencia: mês de referência do boleto/fatura, no formato "AAAA-MM", se identificável (pode ser diferente do mês de vencimento).
- vencimento: data de vencimento do boleto, no formato "AAAA-MM-DD".
- valor: valor total do boleto/demonstrativo, como número (ex: 1234.56), sem símbolo de moeda.
- numero_documento: número/identificador do boleto, da fatura ou da apólice, se houver.
- cnpj_tomador: CNPJ OU CPF da imobiliária/tomador/sacado/pagador (NÃO o CNPJ da O2 Seguros, que é a corretora — procure quem vai RECEBER/PAGAR esse boleto; algumas imobiliárias são cadastradas como pessoa física, então o documento às vezes traz um CPF de 11 dígitos em vez de CNPJ — extraia mesmo assim), só os números, se aparecer explicitamente no documento.
- identificacao_texto: razão social, nome fantasia ou nome completo da imobiliária/tomador, como aparecem no documento (ou no nome do arquivo, nos casos descritos abaixo).

Responda SEMPRE chamando a ferramenta "extrair_fatura". Nunca responda em texto livre.`;

function montarSystemPrompt(seguradoraConhecida: string | null): string {
  if (!seguradoraConhecida) return SYSTEM_PROMPT_BASE;
  const perfil = PERFIS_SEGURADORAS[seguradoraConhecida];
  const avisoSeguradora = `\n\nEssa fatura já é sabida como sendo da seguradora "${seguradoraConhecida}" (escolhida por quem fez o upload) -- não precisa adivinhar o campo "seguradora", retorne exatamente esse valor.`;
  return `${SYSTEM_PROMPT_BASE}${avisoSeguradora}${perfil ? `\n\n${perfil}` : ""}`;
}

const FERRAMENTA_EXTRACAO: Anthropic.Tool = {
  name: "extrair_fatura",
  description: "Reporta os dados estruturados extraídos de uma fatura/boleto de seguradora.",
  input_schema: {
    type: "object",
    properties: {
      seguradora: { type: ["string", "null"], description: "Nome da seguradora emissora." },
      tipo_documento: {
        type: ["string", "null"],
        enum: ["boleto", "demonstrativo", null],
        description: "\"boleto\" se for o instrumento de pagamento; \"demonstrativo\" se for lista/relatório de apólices.",
      },
      codigo_produtor: { type: ["string", "null"], description: "Código de produtor/corretor, se houver." },
      competencia: { type: ["string", "null"], description: "Mês de referência, formato AAAA-MM." },
      vencimento: { type: ["string", "null"], description: "Data de vencimento, formato AAAA-MM-DD." },
      valor: { type: ["number", "null"], description: "Valor total do boleto/demonstrativo." },
      numero_documento: { type: ["string", "null"], description: "Número do boleto/fatura/apólice, se houver." },
      cnpj_tomador: {
        type: ["string", "null"],
        description: "CNPJ ou CPF da imobiliária/tomador/sacado (não da O2), só números, se aparecer no documento.",
      },
      identificacao_texto: {
        type: ["string", "null"],
        description: "Razão social, nome fantasia ou nome completo da imobiliária/tomador como aparecem no documento (ou no nome do arquivo, se instruído acima).",
      },
    },
    required: [
      "seguradora",
      "tipo_documento",
      "codigo_produtor",
      "competencia",
      "vencimento",
      "valor",
      "numero_documento",
      "cnpj_tomador",
      "identificacao_texto",
    ],
  },
};

export async function extrairDadosFatura(
  textoFatura: string,
  opts?: { seguradora?: string | null; nomeArquivo?: string | null }
): Promise<DadosFaturaExtraidos> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Extração de faturas não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });

  const nomeArquivoTexto = opts?.nomeArquivo ? `NOME DO ARQUIVO: ${opts.nomeArquivo}\n\n` : "";
  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    system: montarSystemPrompt(opts?.seguradora ?? null),
    tools: [FERRAMENTA_EXTRACAO],
    tool_choice: { type: "tool", name: "extrair_fatura" },
    messages: [{ role: "user", content: `${nomeArquivoTexto}TEXTO EXTRAÍDO DA FATURA:\n\n${textoFatura}` }],
  });

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou dados estruturados da fatura.");
  }

  return chamada.input as DadosFaturaExtraidos;
}
