import Anthropic from "@anthropic-ai/sdk";

export type StatusChecklist = "ok" | "atencao" | "problema" | "nao_avaliado";

export type ItemChecklist = {
  status: StatusChecklist;
  resumo: string;
};

export type RelatorioAuditoria = {
  status_geral: "APROVADO" | "APROVADO_RESSALVAS" | "REPROVADO";
  tipo_garantia_identificada: string;
  locador_identificado: string;
  locatario_identificado: string;
  endereco_identificado: string;
  dados_cadastrais: ItemChecklist;
  dados_locacao: ItemChecklist;
  conferencia_cotacao: ItemChecklist;
  clausulas_seguradora: ItemChecklist;
  assinaturas: ItemChecklist;
  pontos_criticos: string[];
};

export type ClausulaReferencia = {
  seguradora: string;
  produto: string;
  clausulaBase: string;
};

export type FonteDocumento = { tipo: "texto"; texto: string } | { tipo: "pdf"; base64: string };

const SYSTEM_PROMPT = `Você é um Auditor Especialista em Contratos de Locação Imobiliária brasileira. Sua função é analisar um contrato de locação e devolver um checklist CURTO e direto — quem lê é a imobiliária, que não tem paciência para ler críticas longas. Cada item do checklist deve ter no máximo UMA frase curta, direto ao ponto. Só entre em detalhe (em "pontos_criticos") para os problemas realmente graves.

O contrato (e, se houver, a cotação) podem chegar como texto OU como arquivo PDF anexado diretamente (quando o PDF é escaneado e não tem texto extraível). Se vier como PDF anexado, leia o conteúdo diretamente das páginas/imagens do documento, exatamente como faria com o texto.

Se o arquivo do contrato incluir, anexado nas últimas páginas, um Laudo/Relatório de Vistoria (fotos do imóvel, checklist de estado de conservação, ambiente por ambiente), IGNORE completamente essas páginas na sua análise — elas não são cláusulas contratuais e não devem gerar nenhum apontamento (não cobre assinatura nelas, não avalie o conteúdo delas). Analise só as páginas que são de fato o contrato de locação.

ANTES DE QUALQUER OUTRA COISA: preencha locador_identificado, locatario_identificado e endereco_identificado com o valor exato encontrado na cláusula de qualificação das partes (normalmente logo no início do contrato). Esses 3 campos são OBRIGATÓRIOS e NUNCA podem ficar vazios quando a informação existir no texto. Só use "Não identificado" se realmente não constar em lugar nenhum.

Avalie os 5 pilares abaixo, cada um com um status ("ok", "atencao", "problema" ou "nao_avaliado") e um resumo de uma frase:

1. DADOS_CADASTRAIS — nome do(s) locatário(s), CPF/CNPJ, nome do(s) locador(es). "problema" se faltar ou estiver incompleto/incoerente algum desses dados.

2. DADOS_LOCACAO — endereço completo do imóvel, tipo (residencial/não residencial), valor do aluguel, prazo da locação (datas de início/término coerentes). "problema" se algum desses dados estiver ausente, ambíguo ou incoerente.

3. CONFERENCIA_COTACAO — só avalie se uma COTAÇÃO/PROPOSTA DE SEGURO for fornecida abaixo. Compare segurado/locatário, valor do aluguel, prazo e endereço entre o contrato e a cotação. Se NENHUMA cotação for fornecida, use status "nao_avaliado" e resumo "Nenhuma cotação/proposta anexada para conferência.".

4. CLAUSULAS_SEGURADORA — só se aplica quando a garantia for Seguro Fiança ou Título de Capitalização. Se a garantia for Fiador ou Caução, use status "nao_avaliado" e resumo "Não se aplica — garantia não é seguro-fiança nem título de capitalização.". Quando se aplicar e uma BIBLIOTECA DE CLÁUSULAS DE REFERÊNCIA for fornecida, verifique se a cláusula do contrato tem o mesmo conteúdo essencial do texto oficial daquele produto/seguradora (sem trechos essenciais alterados, removidos ou incompatíveis). Se a seguradora/produto citado não constar na biblioteca fornecida, use "nao_avaliado" com resumo explicando que não há como validar. A Lei do Inquilinato (art. 37) proíbe mais de uma modalidade de garantia no mesmo contrato — se houver DUPLA GARANTIA, isso é "problema" aqui E deve virar um item em pontos_criticos.

5. ASSINATURAS — verifique: (a) previsão/presença de assinatura do(s) locador(es) ou de seu representante legal; (b) do(s) locatário(s); (c) de testemunhas quando exigidas; (d) se há relatório/certificado de assinatura eletrônica (Clicksign, ZapSign, D4Sign, DocuSign ou similar) anexado ao texto, e se ele indica que TODOS os signatários concluíram a assinatura; (e) qualquer assinatura pendente, recusada ou inválida; (f) se os nomes nas assinaturas correspondem às partes qualificadas no contrato. "problema" se faltar assinatura de alguma parte qualificada, houver pendência/recusa, ou nome divergente. "atencao" se não for possível confirmar (ex: contrato sem página de assinatura no texto fornecido).

pontos_criticos: lista curta (pode ficar vazia) só com os problemas mais sérios que merecem destaque além do resumo de uma frase — cada item também deve ser curto (uma frase, cite a cláusula/seção quando possível). Não repita aqui o que já foi dito nos resumos dos 5 pilares, a menos que seja crítico o suficiente para reforçar.

status_geral: "APROVADO" se todos os pilares avaliados estão "ok" (os "nao_avaliado" não contam contra); "APROVADO_RESSALVAS" se houver "atencao" ou "problema" leve/pontual; "REPROVADO" se houver "problema" grave (ex: dupla garantia, dado essencial ausente, assinatura de parte faltando).

Responda SEMPRE chamando a ferramenta "reportar_auditoria". Nunca responda em texto livre.`;

const ITEM_CHECKLIST_SCHEMA = {
  type: "object" as const,
  properties: {
    status: {
      type: "string",
      enum: ["ok", "atencao", "problema", "nao_avaliado"],
    },
    resumo: {
      type: "string",
      minLength: 1,
      description: "Uma frase curta, direto ao ponto.",
    },
  },
  required: ["status", "resumo"],
};

const FERRAMENTA_RELATORIO: Anthropic.Tool = {
  name: "reportar_auditoria",
  description: "Reporta o checklist resumido da auditoria de um contrato de locação.",
  input_schema: {
    type: "object",
    properties: {
      locador_identificado: {
        type: "string",
        minLength: 1,
        description: 'OBRIGATÓRIO. Nome completo do(s) locador(es), separados por "; " se houver mais de um. NUNCA deixe em branco quando a informação existir no contrato.',
      },
      locatario_identificado: {
        type: "string",
        minLength: 1,
        description: 'OBRIGATÓRIO. Nome completo do(s) locatário(s), separados por "; " se houver mais de um. NUNCA deixe em branco quando a informação existir no contrato.',
      },
      endereco_identificado: {
        type: "string",
        minLength: 1,
        description: "OBRIGATÓRIO. Endereço do imóvel locado, resumido em uma linha. NUNCA deixe em branco quando a informação existir no contrato.",
      },
      status_geral: {
        type: "string",
        enum: ["APROVADO", "APROVADO_RESSALVAS", "REPROVADO"],
        description: "Veredito final considerando os 5 pilares do checklist.",
      },
      tipo_garantia_identificada: {
        type: "string",
        description: 'Ex: "Fiador", "Caução", "Seguro Fiança", "Título de Capitalização", "Sem garantia identificada", ou "DUPLA GARANTIA (ERRO)" se houver mais de uma.',
      },
      dados_cadastrais: ITEM_CHECKLIST_SCHEMA,
      dados_locacao: ITEM_CHECKLIST_SCHEMA,
      conferencia_cotacao: ITEM_CHECKLIST_SCHEMA,
      clausulas_seguradora: ITEM_CHECKLIST_SCHEMA,
      assinaturas: ITEM_CHECKLIST_SCHEMA,
      pontos_criticos: {
        type: "array",
        description: "Lista curta (pode ser vazia) só com os problemas mais graves, uma frase cada.",
        items: { type: "string" },
      },
    },
    required: [
      "locador_identificado",
      "locatario_identificado",
      "endereco_identificado",
      "status_geral",
      "tipo_garantia_identificada",
      "dados_cadastrais",
      "dados_locacao",
      "conferencia_cotacao",
      "clausulas_seguradora",
      "assinaturas",
      "pontos_criticos",
    ],
  },
};

// PDF escaneado (sem texto extraível) vai como bloco de documento, pra IA ler
// direto das páginas; texto normal só entra embutido no bloco de texto.
function blocosDoDocumento(rotulo: string, fonte: FonteDocumento): Anthropic.ContentBlockParam[] {
  if (fonte.tipo === "texto") {
    return [{ type: "text", text: `${rotulo}:\n\n${fonte.texto}` }];
  }
  return [
    { type: "text", text: `${rotulo} (arquivo PDF escaneado anexado abaixo — leia direto das páginas):` },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: fonte.base64 } },
  ];
}

export async function auditarContrato(
  contrato: FonteDocumento,
  bibliotecaClausulas: ClausulaReferencia[] = [],
  cotacao: FonteDocumento | null = null
): Promise<RelatorioAuditoria> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Auditor de contrato não configurado: falta a variável de ambiente ANTHROPIC_API_KEY."
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const blocoBiblioteca = bibliotecaClausulas.length
    ? `BIBLIOTECA DE CLÁUSULAS DE REFERÊNCIA DA O2 (texto oficial de cada seguradora/produto — use para conferir o enquadramento da cláusula de garantia do contrato quando ela for baseada em seguro ou título de capitalização):\n\n${bibliotecaClausulas
        .map((c) => `— ${c.seguradora} — ${c.produto} —\n${c.clausulaBase}`)
        .join("\n\n")}\n\n---\n\n`
    : "";

  const conteudo: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `${blocoBiblioteca}Analise o contrato de locação a seguir e reporte o checklist.` },
    ...blocosDoDocumento("CONTRATO DE LOCAÇÃO A SER AUDITADO", contrato),
  ];

  if (cotacao) {
    conteudo.push(
      ...blocosDoDocumento(
        "COTAÇÃO/PROPOSTA DE SEGURO (documento de referência para o pilar CONFERENCIA_COTACAO — compare contra o contrato acima)",
        cotacao
      )
    );
  }

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    // PDFs escaneados grandes (a IA lendo página por página) consomem bem
    // mais tokens de saída antes de chegar no relatório final — um limite
    // baixo corta a resposta no meio, deixando os últimos campos do
    // checklist vazios mesmo com a instrução de ser resumido. 8000 ainda não
    // era suficiente para um PDF real de 22 páginas escaneadas.
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_RELATORIO],
    tool_choice: { type: "tool", name: "reportar_auditoria" },
    messages: [{ role: "user", content: conteudo }],
  });

  // Se a resposta foi cortada por limite de tokens, os campos que vêm depois
  // no schema (o checklist) ficam faltando silenciosamente — melhor avisar
  // com clareza do que salvar um relatório incompleto disfarçado de "não
  // avaliado".
  if (mensagem.stop_reason === "max_tokens") {
    throw new Error(
      "A análise deste contrato ficou grande demais e foi cortada pela IA antes de terminar. Tente novamente — se persistir, tente enviar só as páginas do contrato, sem anexos extras."
    );
  }

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou um relatório estruturado.");
  }

  // Diagnóstico temporário: o checklist tem vindo faltando mesmo sem
  // estourar max_tokens. Loga o motivo real de parada e quais campos
  // vieram, pra investigar direto pelos Runtime Logs da Vercel.
  console.log(
    "[auditor] stop_reason:",
    mensagem.stop_reason,
    "| usage:",
    JSON.stringify(mensagem.usage),
    "| campos:",
    Object.keys(chamada.input as object).join(", ")
  );

  return chamada.input as RelatorioAuditoria;
}
