import Anthropic from "@anthropic-ai/sdk";

export type ItemAuditoria = {
  secao: string;
  problema: string;
  correcao: string;
};

export type RelatorioAuditoria = {
  status_geral: "APROVADO" | "REQUER_AJUSTES" | "ALERTA_CRITICO";
  tipo_garantia_identificada: string;
  inconsistencias_criticas: ItemAuditoria[];
  divergencias: ItemAuditoria[];
  erros_formatacao: ItemAuditoria[];
  observacoes: string[];
};

export type ClausulaReferencia = {
  seguradora: string;
  produto: string;
  clausulaBase: string;
};

const SYSTEM_PROMPT = `Você é um Auditor Especialista em Contratos de Locação Imobiliária e Análise Jurídico-Documental brasileira. Sua função é analisar o texto de um contrato de locação para identificar incorreções, divergências, erros de digitação, falhas de formatação e inconformidades jurídicas.

Execute uma verificação minuciosa nos seguintes pilares:

1. QUALIFICAÇÃO DAS PARTES
- Locador(es) e Locatário(s): nome completo, CPF/CNPJ, RG, estado civil, nacionalidade, profissão e endereço, sem erros de digitação e completos.
- Se o Locador não for o Proprietário citado, sinalize a necessidade de procuração ou contrato de administração.
- Se houver Fiador ou Locador casado (a depender do regime de bens), verifique se o cônjuge está qualificado e incluído para assinatura (outorga uxória).
- Verifique se HÁ PREVISÃO DE ASSINATURA de todas as partes qualificadas no corpo do contrato (locador(es), locatário(s), fiador(es) se houver) e de testemunhas. Se alguma parte qualificada no texto não aparecer na seção de assinaturas, ou faltar testemunha, sinalize.
- Preste atenção a QUALQUER pessoa mencionada no texto (em cláusulas, na seção de assinaturas, num anexo) que pareça ser parte do contrato mas NÃO tenha sido plenamente qualificada nas seções de partes (ex.: um segundo locatário citado só na assinatura, um procurador, um cônjuge). Você não tem acesso aos dados oficiais de enquadramento da seguradora, então NUNCA afirme categoricamente que isso é um erro — inclua em "observacoes" um aviso de atenção recomendando que a imobiliária confirme se essa pessoa foi corretamente incluída no enquadramento do risco junto à seguradora/administradora.

2. DADOS DO IMÓVEL E DA LOCAÇÃO
- Endereço do imóvel completo (rua/av, número, complemento, bairro, cidade, estado, CEP) e coerente em todo o texto.
- Finalidade (Residencial ou Não Residencial/Comercial) clara e coerente.
- Datas de início, término e prazo total coerentes entre si.

3. VALORES E CLÁUSULAS FINANCEIRAS
- Valor do aluguel presente, claro e sem ambiguidade no contrato.
- Divergência entre valor numérico e valor por extenso.
- Data de vencimento, forma de pagamento, multa por atraso, índice de reajuste anual, responsabilidade por condomínio/IPTU.

4. GARANTIAS LOCATÍCIAS
- A Lei do Inquilinato (Lei 8.245/91, art. 37) proíbe mais de uma modalidade de garantia no mesmo contrato — verifique se há só UMA (fiador, caução ou seguro-fiança/título de capitalização).
- Caução em dinheiro: valor não deve exceder 3 meses de aluguel; deve citar conta poupança conjunta.
- Fiador: dados do fiador (e cônjuge, se houver) e do imóvel dado em garantia completos.
- Seguro-fiança/título de capitalização: condições e apólice compatíveis com o informado.
- Seguro incêndio NÃO é uma garantia alternativa da locação — é item separado e não deve ser contado como "dupla garantia" se aparecer junto com a garantia locatícia.
- Se a garantia for seguro-fiança ou título de capitalização E uma BIBLIOTECA DE CLÁUSULAS DE REFERÊNCIA for fornecida abaixo: identifique qual seguradora/produto o contrato diz usar e COMPARE o texto da cláusula de garantia do contrato com o texto oficial correspondente na biblioteca. Aponte em "divergencias" ou "inconsistencias_criticas" (conforme a gravidade) qualquer trecho essencial ausente, alterado ou incompatível com o texto oficial daquele produto. Se a seguradora/produto citado no contrato não constar na biblioteca fornecida, registre isso em "observacoes" (não há como validar o enquadramento).

5. CORRESPONDÊNCIA COM A COTAÇÃO/PROPOSTA DE SEGURO (somente se uma COTAÇÃO for fornecida abaixo)
- Compare segurado/locatário, valor do aluguel, prazo da locação e endereço do imóvel entre o contrato e a cotação.
- Aponte em "divergencias" ou "inconsistencias_criticas" (conforme a gravidade) qualquer dado do contrato que não bata com a cotação.
- Se nenhuma cotação for fornecida, não avalie este pilar e não mencione a ausência dela.

6. ERROS DE DIGITAÇÃO, FORMATAÇÃO E LÓGICA
- Numeração de cláusulas fora de sequência (pula ou repete número).
- Erros gramaticais, nomes próprios grafados de formas diferentes ao longo do texto, datas impossíveis, CPF/CNPJ/RG com quantidade de dígitos incorreta.
- Campos em branco, pontilhados "(...)" ou marcadores tipo "[INSERIR NOME]" não preenchidos.

Responda SEMPRE chamando a ferramenta "reportar_auditoria" com o relatório estruturado. Nunca responda em texto livre. Se um pilar inteiro não apresentar problemas, deixe a lista correspondente vazia — não invente problema para preencher. Seja específico: cite a cláusula/seção exata sempre que possível.`;

const FERRAMENTA_RELATORIO: Anthropic.Tool = {
  name: "reportar_auditoria",
  description: "Reporta o resultado estruturado da auditoria de um contrato de locação.",
  input_schema: {
    type: "object",
    properties: {
      status_geral: {
        type: "string",
        enum: ["APROVADO", "REQUER_AJUSTES", "ALERTA_CRITICO"],
        description: "APROVADO se não há problemas relevantes; REQUER_AJUSTES se há divergências/erros menores; ALERTA_CRITICO se há inconsistência crítica (ex: dupla garantia, valores divergentes, dados essenciais ausentes).",
      },
      tipo_garantia_identificada: {
        type: "string",
        description: 'Ex: "Fiador", "Caução", "Seguro Fiança", "Sem garantia identificada", ou "DUPLA GARANTIA (ERRO)" se houver mais de uma.',
      },
      inconsistencias_criticas: {
        type: "array",
        description: "Erros graves: incoerência de valores por extenso, prazos errados, conflito de garantias, dados essenciais ausentes.",
        items: {
          type: "object",
          properties: {
            secao: { type: "string" },
            problema: { type: "string" },
            correcao: { type: "string" },
          },
          required: ["secao", "problema", "correcao"],
        },
      },
      divergencias: {
        type: "array",
        description: "Diferenças de grafia de nomes, divergência de endereços, CPFs/RGs ausentes ou incorretos.",
        items: {
          type: "object",
          properties: {
            secao: { type: "string" },
            problema: { type: "string" },
            correcao: { type: "string" },
          },
          required: ["secao", "problema", "correcao"],
        },
      },
      erros_formatacao: {
        type: "array",
        description: "Numeração de cláusulas duplicada/saltada, erros ortográficos, campos não preenchidos.",
        items: {
          type: "object",
          properties: {
            secao: { type: "string" },
            problema: { type: "string" },
            correcao: { type: "string" },
          },
          required: ["secao", "problema", "correcao"],
        },
      },
      observacoes: {
        type: "array",
        description: "Avisos gerais: ausência de rubricas, falta de testemunhas, prazos que exigem atenção etc.",
        items: { type: "string" },
      },
    },
    required: [
      "status_geral",
      "tipo_garantia_identificada",
      "inconsistencias_criticas",
      "divergencias",
      "erros_formatacao",
      "observacoes",
    ],
  },
};

export async function auditarContrato(
  textoContrato: string,
  bibliotecaClausulas: ClausulaReferencia[] = [],
  textoCotacao: string | null = null
): Promise<RelatorioAuditoria> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Auditor de contrato não configurado: falta a variável de ambiente ANTHROPIC_API_KEY."
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const blocoBiblioteca = bibliotecaClausulas.length
    ? `BIBLIOTECA DE CLÁUSULAS DE REFERÊNCIA DA O2 (texto oficial de cada seguradora/produto — use para conferir o enquadramento da cláusula de garantia do contrato quando ela for baseada em seguro):\n\n${bibliotecaClausulas
        .map((c) => `— ${c.seguradora} — ${c.produto} —\n${c.clausulaBase}`)
        .join("\n\n")}\n\n---\n\n`
    : "";

  const blocoCotacao = textoCotacao
    ? `COTAÇÃO/PROPOSTA DE SEGURO (documento de referência para o pilar 5 — compare contra o contrato abaixo):\n\n${textoCotacao}\n\n---\n\n`
    : "";

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_RELATORIO],
    tool_choice: { type: "tool", name: "reportar_auditoria" },
    messages: [
      {
        role: "user",
        content: `${blocoBiblioteca}${blocoCotacao}Analise o contrato de locação abaixo e reporte a auditoria:\n\n${textoContrato}`,
      },
    ],
  });

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou um relatório estruturado.");
  }

  return chamada.input as RelatorioAuditoria;
}
