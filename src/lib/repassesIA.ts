import Anthropic from "@anthropic-ai/sdk";

// Schema achatado (mesmo cuidado de faturasIA.ts) -- vale tanto pro
// relatório do Corp quanto pro comprovante bancário, cada um preenchendo só
// os campos que fazem sentido pro seu tipo (o outro lado fica null).
export type DadosRepasseExtraidos = {
  tipo_documento: "relatorio" | "comprovante" | null;
  nome_produtor: string | null; // "Produtor" no relatório, ou nome de quem recebe no comprovante
  email_produtor: string | null; // só o relatório costuma trazer ("Email do Produtor")
  codigo_produtor_corp: string | null; // número que identifica o produtor no Corp (ex: "406")
  cpf_cnpj_produtor: string | null; // só o comprovante costuma trazer, de quem recebe o PIX/TED
  valor: number | null; // Total Líquido (relatório) ou Valor (comprovante) -- os 2 devem bater
  data_pagamento: string | null; // data da transferência, formato AAAA-MM-DD (só comprovante)
  competencia: string | null; // mês de referência do repasse, formato AAAA-MM, se identificável
};

const SYSTEM_PROMPT = `Você extrai dados estruturados de um documento do fluxo de REPASSE DE COMISSÃO da O2 Seguros (corretora) para uma imobiliária/produtor.

Existem 2 tipos de documento possíveis, sempre em PDF:

1) RELATÓRIO (exportado do sistema interno "Corp"/SGCS): título "Relatório de repasse de comissões". Lista, linha a linha, os seguros/inquilinos que compõem o repasse daquele mês, com um total no fim. Sinais típicos: "Agente:", "Produtor: <NOME>", uma tabela com colunas Segurado/Seg./Ramo/Documento/Parc./Vl. Repasse, e no rodapé "Total do Produtor: <CÓDIGO> <NOME>", "Desconto (X %):", "Total Líquido:" (o valor final de fato repassado, DEPOIS do desconto -- não confundir com o "Total em Reais" bruto, que é antes do desconto), "Banco:", "Favorecido:", "Ag.:", "C/C:", "Email do Produtor: <email>".

2) COMPROVANTE (de banco, ex: Itaú, Bradesco, etc): título tipicamente "Comprovante de transferência" ou similar. Mostra "Dados de quem está pagando" (sempre a O2 Corretora de Seguros -- ignore esses dados) e "Dados de quem está recebendo" (nome e CPF/CNPJ de quem recebeu o PIX/TED -- é isso que importa), e "Dados da transação" (Valor, Data da transferência).

Extraia SOMENTE o que estiver realmente presente no texto -- nunca invente ou deduza. Se um campo não for identificável nesse tipo de documento, retorne null.

Preencha:
- tipo_documento: "relatorio" ou "comprovante", conforme os sinais acima. Se não conseguir distinguir, retorne null.
- nome_produtor: no relatório, o nome que aparece em "Produtor:" (não o "Agente:", que é só uma categoria genérica, ex: "IMOBILIÁRIA" -- e não o "Favorecido:", que deve ser o mesmo nome mas às vezes vem levemente diferente, prefira sempre o valor de "Produtor:"). No comprovante, o nome em "Dados de quem está recebendo" -> "Nome".
- email_produtor: valor de "Email do Produtor:", se houver (normalmente só no relatório).
- codigo_produtor_corp: o número que aparece logo antes do nome em "Total do Produtor: <número> <nome>" (ex: em "Total do Produtor: 406 CARLA MARCOS PINNA", o código é "406"). Só existe no relatório.
- cpf_cnpj_produtor: CPF ou CNPJ de quem recebe, só números -- normalmente só o comprovante traz isso, em "Dados de quem está recebendo" -> "CPF ou CNPJ".
- valor: no relatório, o "Total Líquido" (valor final após desconto, não o "Total em Reais" bruto). No comprovante, o "Valor" da transação. Como número (ex: 60.23), sem símbolo de moeda.
- data_pagamento: data da transferência, formato AAAA-MM-DD -- só o comprovante traz isso.
- competencia: mês de referência do repasse, formato AAAA-MM, se identificável no texto (ex: pelos filtros de data do relatório, ou por menção explícita a um mês). Se não achar, retorne null -- quem faz upload já escolhe a competência manualmente, esse campo é só um reforço quando disponível.

Responda SEMPRE chamando a ferramenta "extrair_repasse". Nunca responda em texto livre.`;

const FERRAMENTA_EXTRACAO: Anthropic.Tool = {
  name: "extrair_repasse",
  description: "Reporta os dados estruturados extraídos de um relatório de repasse ou comprovante de pagamento.",
  input_schema: {
    type: "object",
    properties: {
      tipo_documento: { type: ["string", "null"], enum: ["relatorio", "comprovante", null] },
      nome_produtor: { type: ["string", "null"] },
      email_produtor: { type: ["string", "null"] },
      codigo_produtor_corp: { type: ["string", "null"] },
      cpf_cnpj_produtor: { type: ["string", "null"] },
      valor: { type: ["number", "null"] },
      data_pagamento: { type: ["string", "null"] },
      competencia: { type: ["string", "null"] },
    },
    required: [
      "tipo_documento",
      "nome_produtor",
      "email_produtor",
      "codigo_produtor_corp",
      "cpf_cnpj_produtor",
      "valor",
      "data_pagamento",
      "competencia",
    ],
  },
};

export async function extrairDadosRepasse(
  textoDocumento: string,
  opts?: { nomeArquivo?: string | null }
): Promise<DadosRepasseExtraidos> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Extração de repasses não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });
  const nomeArquivoTexto = opts?.nomeArquivo ? `NOME DO ARQUIVO: ${opts.nomeArquivo}\n\n` : "";

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_EXTRACAO],
    tool_choice: { type: "tool", name: "extrair_repasse" },
    messages: [{ role: "user", content: `${nomeArquivoTexto}TEXTO EXTRAÍDO DO DOCUMENTO:\n\n${textoDocumento}` }],
  });

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou dados estruturados do repasse.");
  }

  return chamada.input as DadosRepasseExtraidos;
}
