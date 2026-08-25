import Anthropic from "@anthropic-ai/sdk";

export type StatusChecklist = "ok" | "atencao" | "problema" | "nao_avaliado";

export type RelatorioAuditoria = {
  status_geral: "APROVADO" | "APROVADO_RESSALVAS" | "REPROVADO";
  tipo_garantia_identificada: string;
  locador_identificado: string;
  locatario_identificado: string;
  endereco_identificado: string;
  dados_cadastrais_status: StatusChecklist;
  dados_cadastrais_resumo: string;
  dados_locacao_status: StatusChecklist;
  dados_locacao_resumo: string;
  conferencia_cotacao_status: StatusChecklist;
  conferencia_cotacao_resumo: string;
  clausulas_seguradora_status: StatusChecklist;
  clausulas_seguradora_resumo: string;
  assinaturas_status: StatusChecklist;
  assinaturas_resumo: string;
  pontos_criticos: string[];
};

export type ClausulaReferencia = {
  seguradora: string;
  produto: string;
  clausulaBase: string;
};

export type FonteDocumento =
  | { tipo: "texto"; texto: string }
  | { tipo: "pdf"; base64: string }
  | { tipo: "imagem"; base64: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };

// Um único upload pode virar vários documentos, todos numa lista só (ver
// AuditorForm.tsx) -- cada um marcado com o papel que ele tem na auditoria.
// "contrato" aceita MAIS DE UM (ex: contrato original + aditivo(s)); os
// outros normalmente vêm 0 ou 1 vez, mas nada impede mais de um também.
export type TipoDocumentoAuditoria = "contrato" | "cotacao" | "certificado" | "outro";

export type DocumentoAuditoria = {
  tipo: TipoDocumentoAuditoria;
  fonte: FonteDocumento;
  nomeArquivo?: string | null;
};

const SYSTEM_PROMPT = `Você é um Auditor Especialista em Contratos de Locação Imobiliária brasileira. Sua função é analisar um contrato de locação e devolver um checklist CURTO e direto — quem lê é a imobiliária, que não tem paciência para ler críticas longas. Cada resumo deve ter no máximo UMA frase curta, direto ao ponto. Só entre em detalhe (em "pontos_criticos") para os problemas realmente graves.

O contrato (e, se houver, a cotação e o certificado de assinatura eletrônica) podem chegar como texto, como arquivo PDF anexado diretamente (quando o PDF é escaneado e não tem texto extraível), ou como imagem/print de tela (comum para a cotação, quando a imobiliária só tem um print do sistema da seguradora/CRM em vez de um PDF formal). Se vier como PDF ou imagem anexada, leia o conteúdo diretamente das páginas/imagem, exatamente como faria com o texto.

O CONTRATO pode chegar em MAIS DE UMA PARTE — o caso mais comum é contrato original + um ou mais ADITIVOS que alteram cláusulas específicas dele. Quando isso acontece, cada parte vem rotulada "Parte X de Y" abaixo. Trate todas as partes como um único contrato lógico (some as partes pra montar o quadro completo de partes qualificadas, garantia, etc.). Se um ADITIVO (normalmente reconhecível pelo nome do arquivo ou porque o próprio texto diz explicitamente qual cláusula do contrato original está sendo alterada) entrar em conflito com o contrato original numa mesma cláusula, a versão do ADITIVO prevalece na sua análise, por ser mais recente — mas o que o aditivo NÃO alterar continua valendo do contrato original.

Se o arquivo do contrato incluir, anexado nas últimas páginas, um Laudo/Relatório de Vistoria (fotos do imóvel, checklist de estado de conservação, ambiente por ambiente), IGNORE completamente essas páginas na sua análise — elas não são cláusulas contratuais e não devem gerar nenhum apontamento (não cobre assinatura nelas, não avalie o conteúdo delas). Analise só as páginas que são de fato o contrato de locação. O mesmo vale se um documento desse tipo chegar rotulado "DOCUMENTO ADICIONAL DE CONTEXTO" — se for claramente um laudo/vistoria, ignore; se for outra coisa relevante, use como contexto extra sem forçar em nenhum pilar específico.

ANTES DE QUALQUER OUTRA COISA: preencha locador_identificado, locatario_identificado e endereco_identificado com o valor exato encontrado na cláusula de qualificação das partes (normalmente logo no início do contrato). Esses 3 campos são OBRIGATÓRIOS e NUNCA podem ficar vazios quando a informação existir no texto. Só use "Não identificado" se realmente não constar em lugar nenhum.

LOGO EM SEGUIDA, ainda antes de escrever qualquer status: percorra o contrato INTEIRO, cláusula por cláusula, procurando por TODAS as cláusulas de garantia locatícia — fiador, caução, seguro-fiança e título de capitalização — mesmo que uma delas já pareça óbvia logo no início ou no título de uma cláusula. Não pare na primeira que encontrar. Cada contrato só pode ter UMA modalidade de garantia (art. 37 da Lei do Inquilinato); se aparecerem cláusulas de mais de uma modalidade no mesmo contrato (ex: cláusula de fiador E cláusula de seguro-fiança), isso é DUPLA GARANTIA — preencha tipo_garantia_identificada como "DUPLA GARANTIA (ERRO)", liste as modalidades encontradas, e trate como "problema" de alta prioridade no pilar 4 (clausulas_seguradora) e em pontos_criticos. Este é um gatilho crítico do checklist, não um detalhe a mais — não deixe passar batido mesmo que o restante do contrato pareça bem preenchido.

Você precisa preencher TODOS OS 10 CAMPOS de status/resumo abaixo, um de cada vez, na ordem. Não pule nenhum — mesmo que o pilar não se aplique, preencha com status "nao_avaliado" e um resumo curto explicando por quê. Cada status é "ok", "atencao", "problema" ou "nao_avaliado".

1. dados_cadastrais_status / dados_cadastrais_resumo — nome do(s) locatário(s), CPF/CNPJ, nome do(s) locador(es). IMPORTANTE: identifique QUANTOS locatários existem (pode ser um casal, fiadores adicionais como locatário solidário, pessoa jurídica etc.) e confirme que TODOS estão devidamente qualificados (nome completo + CPF/CNPJ) — não considere resolvido se só o primeiro locatário tiver dados completos e os demais estiverem incompletos ou ausentes. "problema" se faltar ou estiver incompleto/incoerente algum desses dados para qualquer uma das partes.

   Verifique também se o contrato identifica um MORADOR ADICIONAL, diferente do(s) locatário(s) — normalmente aparece numa cláusula de finalidade/uso do imóvel (ex: "a presente locação... tendo também como morador(a) [NOME], [qualificação], RG..., CPF..."). Se houver, cite o nome completo dessa pessoa no resumo, em uma frase própria, no formato "Há incidência de morador adicional além do(s) locatário(s): [NOME]." — isso é só uma informação a mais pro resumo, não conta como "problema" por si só (a menos que a qualificação dessa pessoa esteja incompleta, ou que ela devesse constar como locatária solidária e não conste). Se não houver menção a nenhum morador adicional, não precisa dizer nada sobre isso.

2. dados_locacao_status / dados_locacao_resumo — endereço completo do imóvel (incluindo CEP), finalidade do imóvel classificada explicitamente como "Residencial" ou "Comercial" (não aceite resposta vaga tipo "uso normal" — se o contrato não deixar claro qual das duas, isso já é "atencao"), valor do aluguel, prazo da locação (datas de início/término coerentes). "problema" se algum desses dados estiver ausente, ambíguo ou incoerente; "problema" também se o CEP estiver ausente do endereço.

3. conferencia_cotacao_status / conferencia_cotacao_resumo — o resumo deste pilar SEMPRE precisa trazer, de forma explícita, o nome do locador, o nome de TODOS os locatários e o endereço (com CEP) do imóvel identificados no contrato — em todo relatório, tenha cotação anexada ou não. Isso é pra quem está lendo poder comparar na hora com a cotação que tem em mãos, sem precisar procurar essa informação em outro lugar do relatório.

   - Se um documento de referência for fornecido abaixo (rotulado "COTAÇÃO/PROPOSTA DE SEGURO"), NUNCA julgue ou questione se o arquivo É de fato uma cotação formal — ele pode ser um print de tela do sistema, uma ficha cadastral do locatário/fiador parcialmente preenchida, um formulário do CRM, ou qualquer outro documento que a imobiliária tinha em mãos no momento. Sua tarefa não é classificar o tipo do arquivo, é EXTRAIR dele qualquer nome, endereço, CEP, valor de aluguel ou prazo que estiver preenchido/legível e comparar com o contrato. Nunca responda com algo como "este documento não é uma cotação válida para comparação" ou "confira manualmente" quando um documento de referência foi anexado — isso só vale para quando NENHUM documento foi anexado (ver abaixo). Se o documento anexado estiver parcial ou majoritariamente em branco, compare o que houver preenchido e diga explicitamente, campo a campo, o que não foi possível conferir por estar ausente/em branco NESSE documento (não porque "não é uma cotação") — nunca deixe de tentar a comparação.
   - Compare PONTO A PONTO entre contrato e documento de referência:
     a) Locatário(s) — primeiro confira a QUANTIDADE de locatários citados na cotação contra a quantidade qualificada no contrato (ex: cotação cita 2 segurados/locatários e o contrato só qualifica 1 — isso é "problema", mesmo que o nome do primeiro bata perfeitamente). Depois confira o nome de cada um. Nunca diga só "diverge" ou "não confere" sem apontar os nomes dos dois lados. Ex: "Locatários no contrato: João Silva; na cotação constam 2 segurados: João Silva e Maria Souza — Maria não aparece qualificada no contrato.".
     b) Endereço do local de risco, incluindo o CEP — o CEP do contrato precisa bater exatamente com o CEP da cotação, não só o logradouro. Ex: "Endereço do contrato: Rua X, 100, CEP 20000-000; da cotação: Rua X, 100, CEP 20000-001 — CEP diverge, confirme se é o mesmo imóvel.".
     c) Valor do aluguel — compare o valor exato; qualquer diferença é "atencao" ou "problema" conforme a magnitude, e cite os dois valores.
     d) Finalidade do imóvel (Residencial/Comercial) — se a cotação foi emitida para uma finalidade e o contrato descreve outra, isso é "problema" grave (pode invalidar a cobertura do seguro) e deve constar também em pontos_criticos.
     e) Prazo da locação.
     Status "ok" só se locador, TODOS os locatários (nome e quantidade), valor, prazo, endereço/CEP e finalidade baterem completamente entre os dois documentos; "atencao" ou "problema" (conforme a gravidade) se houver qualquer divergência.
   - Se NENHUMA cotação for fornecida: use status "nao_avaliado", e o resumo deve seguir o formato "Sem cotação anexada para conferência automática — confira manualmente: Locador: [nome]. Locatário(s): [nome(s)]. Endereço (CEP): [endereço com CEP].".

4. clausulas_seguradora_status / clausulas_seguradora_resumo — o que validar aqui depende do tipo de garantia identificado no passo de DUPLA GARANTIA acima. NÃO analise isso só pensando em seguro-fiança/capitalização — Fiador e Caução também têm cláusula obrigatória a conferir (ver abaixo). Se você já identificou DUPLA GARANTIA, este pilar é automaticamente "problema" (reforce aqui o que já foi apontado, com os nomes das modalidades encontradas).

   — Se a garantia for Seguro Fiança ou Título de Capitalização e uma BIBLIOTECA DE CLÁUSULAS DE REFERÊNCIA for fornecida, verifique se a cláusula do contrato tem o mesmo conteúdo essencial do texto oficial daquele produto/seguradora (sem trechos essenciais alterados, removidos ou incompatíveis). Se a seguradora/produto citado não constar na biblioteca fornecida, use "nao_avaliado" com resumo explicando que não há como validar.

   — Se a garantia for Fiador ou Caução: não há biblioteca de referência pra esses dois (cada imobiliária redige a própria cláusula) — a checagem aqui é de COESÃO do próprio contrato, não de comparação com um texto externo. Confirme que a cláusula de fato existe no contrato (não só que o tipo de garantia foi citado em algum lugar) e que está completa:
      · Fiador — fiador(es) devidamente qualificado(s) (nome completo, CPF/RG, endereço, estado civil) e presença de cláusula de responsabilidade solidária. "problema" se a garantia foi identificada como Fiador mas não há cláusula de fiador no corpo do contrato, ou se a qualificação do fiador estiver incompleta.
      · Caução — valor caucionado expresso e forma da garantia (dinheiro, título, bens) definida, e o valor NÃO pode ultrapassar o equivalente a 3 (três) meses de aluguel (art. 38 da Lei 8.245/91) — se ultrapassar, "problema" com os dois valores citados em pontos_criticos. "problema" também se a garantia foi identificada como Caução mas o valor ou a forma da garantia não estiverem expressos no contrato.

   ATENÇÃO A CLÁUSULAS CONDICIONAIS (vale para QUALQUER seguradora, não só Tokio Marine): a biblioteca pode trazer, além da(s) cláusula(s) sempre obrigatória(s), cláusulas ou parágrafos rotulados como condicionais/opcionais — reconheça pelo próprio texto da biblioteca (marcações como "quando contratada a cobertura de X", "cláusula especial", "opcional", "aplicável quando houver mais de um locatário", "parágrafo aplicável a...", etc.), não só pelo formato específico da Tokio (Cláusula Especial nº 2/3/4). Para cada cláusula/parágrafo condicional identificado na biblioteca daquele produto/seguradora:
      a) verifique se a cotação/proposta ou o próprio contrato indicam que a condição se aplica (ex: cobertura extra contratada, mais de um locatário no contrato, procuração outorgada a terceiro);
      b) SEMPRE relate no resumo, de forma explícita e nomeada, quais cláusulas condicionais da biblioteca se aplicam a este contrato e se cada uma foi encontrada ou não — nunca deixe implícito num "ok"/"problema" genérico sem dizer qual cláusula foi checada. Ex: "Cláusula Especial nº 3 (Pintura Interna) se aplica (cobertura contratada) e está presente; nº 2 e nº 4 não se aplicam.", ou "Contrato tem 2 locatários mas o parágrafo de solidariedade entre locatários não está presente — problema.". Se nenhuma cláusula condicional da biblioteca se aplicar a este contrato, diga isso também (ex: "Nenhuma cláusula condicional aplicável identificada.").
      c) se a condição se aplica mas a cláusula correspondente NÃO aparece no contrato (ou aparece incompleta), isso é "problema" — o contrato foi cortado/truncado antes de incluir todas as cláusulas obrigatórias daquela contratação — e deve virar um item em pontos_criticos citando a cláusula pelo nome/número;
      d) se não há como confirmar se a condição se aplica (ex: sem cotação anexada, ou cotação/e-mail vago demais pra saber quais coberturas foram contratadas), não presuma nem a favor nem contra — use "atencao" e diga no resumo quais cláusulas condicionais existem na biblioteca mas não deu pra confirmar se se aplicam.
      e) ATENÇÃO À REDAÇÃO deste caso (d) — é a fonte nº 1 de confusão pra quem lê o relatório: quando a cláusula JÁ APARECE no texto do contrato e a única dúvida é se a COBERTURA foi comercialmente contratada (não se a cláusula existe), deixe isso cristalino e nunca escreva de um jeito que soe como "a cláusula não foi incluída no contrato" — ela FOI incluída, só a confirmação da contratação é que ficou em aberto. Use sempre esta fórmula: "Cláusula de [nome] está presente no contrato; não foi possível confirmar pela cotação/e-mail se essa cobertura foi efetivamente contratada.". Reserve verbos como "ausente", "não incorporada" ou "não incluída" exclusivamente para quando a cláusula realmente não aparece no texto do contrato (caso (c) acima).

5. assinaturas_status / assinaturas_resumo — primeiro monte mentalmente a lista COMPLETA de partes qualificadas no contrato (cada locador, cada locatário, fiador/anuente se houver, testemunhas quando exigidas) e depois confira, parte por parte, se cada uma efetivamente assinou — nunca aprove esse pilar só porque "tem página de assinatura", sem cruzar contra a lista de partes qualificadas.

   Se um CERTIFICADO DE ASSINATURA ELETRÔNICA for fornecido como documento de referência (comprovante emitido por Clicksign, ZapSign, D4Sign, DocuSign ou similar), ele é a fonte MAIS CONFIÁVEL sobre quem assinou e quando — use-o como base principal deste pilar em vez de confiar só na página de assinatura do próprio contrato (que pode não refletir assinaturas feitas fora do arquivo). Extraia dele, para cada signatário: nome, CPF/documento (mesmo que parcialmente mascarado), data/hora da assinatura, e o código/hash de verificação do documento como um todo. Cite esse código de verificação explicitamente no resumo (ex.: "Código de verificação do certificado: ABC-123.").

   TRIANGULAÇÃO (só quando houver certificado): compare a lista de signatários do certificado com (a) a lista de partes qualificadas no contrato — todo nome do certificado deve corresponder a uma parte qualificada, e toda parte obrigatória a assinar precisa constar no certificado como concluída; e (b) se uma COTAÇÃO/PROPOSTA DE SEGURO também foi fornecida, os nomes de segurados/locatários nela também deveriam aparecer no certificado como signatários. Qualquer nome no certificado sem correspondência no contrato (ou vice-versa), CPF divergente entre os documentos, ou segurado da cotação que o certificado não mostra como assinante, é "problema" — cite os nomes/documentos exatos em pontos_criticos.

   Sem certificado fornecido, confira direto no texto do contrato: (a) previsão/presença de assinatura do(s) locador(es) ou de seu representante legal; (b) de CADA um do(s) locatário(s) qualificado(s) — se são 2 locatários, os 2 precisam ter assinado, não só 1; (c) de testemunhas quando exigidas; (d) qualquer menção a assinatura pendente, recusada ou inválida; (e) se os nomes nas assinaturas correspondem às partes qualificadas no contrato.

   "problema" se faltar assinatura de qualquer parte qualificada (mesmo uma só entre várias), houver pendência/recusa, nome/CPF divergente, ou divergência na triangulação acima. "atencao" se não for possível confirmar (ex: contrato sem página de assinatura no texto fornecido e sem certificado anexado).

pontos_criticos: lista curta (pode ficar vazia) só com os problemas mais sérios que merecem destaque além do resumo de uma frase — cada item também deve ser curto (uma frase, cite a cláusula/seção quando possível). Não repita aqui o que já foi dito nos resumos acima, a menos que seja crítico o suficiente para reforçar.

status_geral: "APROVADO" se todos os pilares avaliados estão "ok" (os "nao_avaliado" não contam contra); "APROVADO_RESSALVAS" se houver "atencao" ou "problema" leve/pontual; "REPROVADO" se houver "problema" grave (ex: dupla garantia, dado essencial ausente, assinatura de parte faltando).

Responda SEMPRE chamando a ferramenta "reportar_auditoria", preenchendo TODOS os campos do schema. Nunca responda em texto livre.`;

const STATUS_ENUM = ["ok", "atencao", "problema", "nao_avaliado"];

const FERRAMENTA_RELATORIO: Anthropic.Tool = {
  name: "reportar_auditoria",
  description: "Reporta o checklist resumido da auditoria de um contrato de locação. TODOS os campos são obrigatórios, incluindo os 10 campos de status/resumo dos 5 pilares.",
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
      dados_cadastrais_status: { type: "string", enum: STATUS_ENUM, description: "Status do pilar 1 (dados cadastrais)." },
      dados_cadastrais_resumo: { type: "string", minLength: 1, description: "Resumo de uma frase do pilar 1 (dados cadastrais)." },
      dados_locacao_status: { type: "string", enum: STATUS_ENUM, description: "Status do pilar 2 (dados da locação)." },
      dados_locacao_resumo: { type: "string", minLength: 1, description: "Resumo de uma frase do pilar 2 (dados da locação)." },
      conferencia_cotacao_status: { type: "string", enum: STATUS_ENUM, description: "Status do pilar 3 (conferência com a cotação)." },
      conferencia_cotacao_resumo: {
        type: "string",
        minLength: 1,
        description:
          "Resumo de uma frase do pilar 3 (conferência com a cotação). Se não houver cotação anexada, mesmo assim inclua locador, locatário e endereço identificados no contrato, pra permitir conferência manual.",
      },
      clausulas_seguradora_status: { type: "string", enum: STATUS_ENUM, description: "Status do pilar 4 (cláusula da garantia — seguro/capitalização, fiador ou caução, conforme o tipo identificado)." },
      clausulas_seguradora_resumo: {
        type: "string",
        minLength: 1,
        description:
          "Resumo curto do pilar 4 (cláusula da garantia). Quando houver cláusulas condicionais na biblioteca (seguro/capitalização), nomeie explicitamente quais se aplicam e se cada uma foi encontrada. Para Fiador/Caução, diga se a cláusula existe e está completa no próprio contrato (qualificação do fiador, ou valor/forma da caução). Pode passar de uma frase se precisar citar mais de um ponto, mas continue direto e sem rodeios.",
      },
      assinaturas_status: { type: "string", enum: STATUS_ENUM, description: "Status do pilar 5 (assinaturas)." },
      assinaturas_resumo: { type: "string", minLength: 1, description: "Resumo de uma frase do pilar 5 (assinaturas)." },
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
      "dados_cadastrais_status",
      "dados_cadastrais_resumo",
      "dados_locacao_status",
      "dados_locacao_resumo",
      "conferencia_cotacao_status",
      "conferencia_cotacao_resumo",
      "clausulas_seguradora_status",
      "clausulas_seguradora_resumo",
      "assinaturas_status",
      "assinaturas_resumo",
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
  if (fonte.tipo === "imagem") {
    return [
      { type: "text", text: `${rotulo} (imagem/print de tela anexado abaixo — leia o conteúdo visível na imagem):` },
      { type: "image", source: { type: "base64", media_type: fonte.mediaType, data: fonte.base64 } },
    ];
  }
  return [
    { type: "text", text: `${rotulo} (arquivo PDF escaneado anexado abaixo — leia direto das páginas):` },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: fonte.base64 } },
  ];
}

// Monta os blocos de um grupo de documentos do mesmo papel (ex: todos os
// "contrato") -- rotula "Parte X de Y" só quando há mais de um, pra não
// poluir o caso comum (1 arquivo só).
function blocosDoGrupo(rotuloBase: string, docs: DocumentoAuditoria[]): Anthropic.ContentBlockParam[] {
  const blocos: Anthropic.ContentBlockParam[] = [];
  docs.forEach((doc, i) => {
    const sufixoArquivo = doc.nomeArquivo ? ` (arquivo: ${doc.nomeArquivo})` : "";
    const rotulo = docs.length > 1 ? `${rotuloBase} — Parte ${i + 1} de ${docs.length}${sufixoArquivo}` : `${rotuloBase}${sufixoArquivo}`;
    blocos.push(...blocosDoDocumento(rotulo, doc.fonte));
  });
  return blocos;
}

export async function auditarContrato(
  documentos: DocumentoAuditoria[],
  bibliotecaClausulas: ClausulaReferencia[] = []
): Promise<RelatorioAuditoria> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Auditor de contrato não configurado: falta a variável de ambiente ANTHROPIC_API_KEY."
    );
  }

  const contratos = documentos.filter((d) => d.tipo === "contrato");
  const cotacoes = documentos.filter((d) => d.tipo === "cotacao");
  const certificados = documentos.filter((d) => d.tipo === "certificado");
  const outros = documentos.filter((d) => d.tipo === "outro");

  if (contratos.length === 0) {
    throw new Error("Nenhum documento de contrato foi identificado — marque ao menos um dos arquivos enviados como \"Contrato/Aditivo\", ou cole o texto do contrato.");
  }

  const anthropic = new Anthropic({ apiKey });

  const blocoBiblioteca = bibliotecaClausulas.length
    ? `BIBLIOTECA DE CLÁUSULAS DE REFERÊNCIA DA O2 (texto oficial de cada seguradora/produto — use para conferir o enquadramento da cláusula de garantia do contrato quando ela for baseada em seguro ou título de capitalização):\n\n${bibliotecaClausulas
        .map((c) => `— ${c.seguradora} — ${c.produto} —\n${c.clausulaBase}`)
        .join("\n\n")}\n\n---\n\n`
    : "";

  const conteudo: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `${blocoBiblioteca}Analise o contrato de locação a seguir e reporte o checklist.` },
    ...blocosDoGrupo("CONTRATO DE LOCAÇÃO A SER AUDITADO", contratos),
  ];

  if (cotacoes.length > 0) {
    conteudo.push(
      ...blocosDoGrupo(
        "COTAÇÃO/PROPOSTA DE SEGURO (documento de referência para o pilar CONFERENCIA_COTACAO — compare contra o contrato acima)",
        cotacoes
      )
    );
  }

  if (certificados.length > 0) {
    conteudo.push(
      ...blocosDoGrupo(
        "CERTIFICADO DE ASSINATURA ELETRÔNICA (documento de referência para o pilar ASSINATURAS — comprovante emitido por Clicksign/ZapSign/D4Sign/DocuSign ou similar, contém código de verificação e dados de quem assinou)",
        certificados
      )
    );
  }

  if (outros.length > 0) {
    conteudo.push(...blocosDoGrupo("DOCUMENTO ADICIONAL DE CONTEXTO", outros));
  }

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_RELATORIO],
    tool_choice: { type: "tool", name: "reportar_auditoria" },
    messages: [{ role: "user", content: conteudo }],
  });

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

  // Diagnóstico temporário: o checklist tinha vindo faltando mesmo sem
  // estourar max_tokens (schema com blocos repetidos confundindo o
  // modelo). Loga os campos retornados pra confirmar que o schema achatado
  // resolveu.
  console.log(
    "[auditor] stop_reason:",
    mensagem.stop_reason,
    "| output_tokens:",
    mensagem.usage?.output_tokens,
    "| campos:",
    Object.keys(chamada.input as object).join(", ")
  );

  return chamada.input as RelatorioAuditoria;
}
