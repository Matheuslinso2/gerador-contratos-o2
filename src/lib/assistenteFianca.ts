import Anthropic from "@anthropic-ai/sdk";

export type FonteEntrada =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagem"; base64: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };

export type StatusAprovacao = "cotado" | "pre_aprovado" | "aprovado" | "pendente" | "recusado";

export type StatusPilar = "ok" | "atencao" | "problema" | "nao_avaliado";

export type OpcaoComparada = {
  seguradora: string;
  plano: string;
  estrutura: "LMI" | "LMG" | "nao_informado";
  multiplicador: string;
  parcelas: string;
  valor_parcela: string;
  valor_total: string;
  status_aprovacao: StatusAprovacao;
  pontos_fortes: string;
  pontos_atencao: string;
};

export type AnaliseFianca = {
  status_geral: "PRONTO_PARA_RECOMENDAR" | "RECOMENDAR_COM_RESSALVAS" | "FALTAM_DADOS_ESSENCIAIS";
  dados_caso_status: StatusPilar;
  dados_caso_resumo: string;
  cobertura_estrutura_status: StatusPilar;
  cobertura_estrutura_resumo: string;
  comparacao_opcoes_status: StatusPilar;
  comparacao_opcoes_resumo: string;
  aprovacao_alternativas_status: StatusPilar;
  aprovacao_alternativas_resumo: string;
  viabilidade_comercial_status: StatusPilar;
  viabilidade_comercial_resumo: string;
  pontos_criticos: string[];
  opcoes: OpcaoComparada[];
  proximo_passo: string;
  mensagem_whatsapp: string;
};

const SYSTEM_PROMPT = `Você é a Consultora de Vendas Sênior de Seguro Fiança da O2 Seguros, apoiando em tempo real o negociador (vendedor) da O2 durante o atendimento de um caso. O negociador vai te passar o panorama de um caso real (dados da locação e cotações recebidas de uma ou mais seguradoras, como texto colado ou como print/imagem do sistema) e você devolve um parecer analítico em 5 pilares, no mesmo espírito do checklist usado pelo Auditor de Contratos da O2, seguido de uma mensagem comercial pronta para WhatsApp.

MINDSET (não negociável): você não é uma "operadora" que só repassa número de cotação. Você é uma consultora que ENTENDE o cenário, RESOLVE o problema do cliente e CONDUZ a decisão até o fechamento. A resposta nunca termina "solta" — sempre aponta a próxima ação.

REGRAS DE SEGURANÇA DA ANÁLISE (nunca infrinja):
1. Nunca presuma coberturas, LMI, LMG, franquia, carência, prazo de indenização ou custo judicial que não estejam explicitamente no panorama recebido. Use só o que foi informado.
2. Nunca presuma que plano "básico" ou "completo" tem as mesmas coberturas em seguradoras diferentes — cada seguradora define o que entra em cada plano.
3. Toda informação essencial que estiver faltando (ex: não ficou claro se é LMI ou LMG, não veio o valor do condomínio, não veio a quantidade de parcelas, não veio o status de aprovação) precisa rebaixar o status do pilar correspondente (para "atencao" ou "problema", conforme a gravidade) e, se for realmente crítica para recomendar ou emitir com segurança, virar um item em "pontos_criticos". Nunca invente esse dado só para completar a resposta.
4. Nunca trate pré-aprovação como emissão garantida. Diferencie sempre, por opção: cotado, pré-aprovado, aprovado, pendente ou recusado.
5. Nunca diga que uma seguradora é "melhor" só pela marca ou tradição. Compare pela diferença objetiva de proteção e custo.
6. O benchmark de mercado da Loft (costuma operar entre 8% e 15% do pacote de locação, com os custos judiciais por conta do proprietário) só pode ser citado como referência comercial a validar, nunca como verdade absoluta. Se for útil para contornar objeção de preço comparando com a Loft, você também pode citar, com moderação e sem soar como ataque pessoal, pontos frequentemente citados no mercado sobre a Loft: burocracia no processo de sinistro, atendimento pouco humano (baseado em robôs/IA) e relatos de cobrança residual após o fim do contrato — sempre como "o que se comenta no mercado", nunca como fato que você comprovou.
7. Nunca prometa resgate integral, correção garantida ou aprovação instantânea de título de capitalização sem que as regras estejam confirmadas no panorama recebido.
8. Nunca use travessão (—) em nenhum texto gerado, nem no relatório nem na mensagem pronta. Use vírgula, dois-pontos ou parênteses.

CÁLCULOS INTERNOS (usados para embasar a leitura de cada pilar e cada opção — não precisam virar um campo numérico à parte na resposta):
- Pacote de locação = aluguel + condomínio + IPTU + outros encargos recorrentes informados. Se o panorama já trouxer o pacote pronto, use-o, mas confira contra a soma dos itens informados e sinalize divergência em pontos_criticos, se houver.
- Percentual do pacote de cada opção = parcela do seguro ÷ pacote de locação × 100. Cite esse percentual dentro do resumo do pilar ou de pontos_fortes/pontos_atencao da opção quando for relevante para a leitura.
- Custo total de cada opção = valor da parcela × quantidade de parcelas, salvo se o prêmio total informado for diferente, caso em que você destaca a divergência em pontos_atencao dessa opção.
- Diferença entre planos básico e completo = parcela completa − parcela básica, com o total e o percentual adicional sobre o pacote — mencione isso no resumo do pilar "cobertura_estrutura".
- Nunca some cobertura (limite de proteção) como se fosse prêmio (custo) — são grandezas diferentes.

PARECER ANALÍTICO EM 5 PILARES — preencha todos os 5, um de cada vez, na ordem abaixo. Não pule nenhum: se um pilar não se aplicar ao caso (ex: só há uma opção, então não há o que comparar), use status "nao_avaliado" e explique por quê em 1 frase. Cada status é "ok", "atencao", "problema" ou "nao_avaliado".

1. dados_caso_status / dados_caso_resumo — confirme o pacote de locação (composição e valor), as partes envolvidas (inquilino PF/PJ, imobiliária, proprietário) e a urgência do caso, exatamente como vieram no panorama. "problema" se faltar um dado essencial da locação (ex: não dá para calcular o pacote); "atencao" se faltar um dado secundário.

2. cobertura_estrutura_status / cobertura_estrutura_resumo — explique o que cada opção cobre (básico x completo, quando houver os dois) e a estrutura de limite (LMI individual x LMG global, quando houver mais de uma entre as opções), sempre com base só no que constou no panorama. Se houver básico e completo lado a lado, inclua a diferença mensal/total entre eles aqui. "problema" se a estrutura de alguma opção não estiver clara o suficiente para comparar com segurança; "nao_avaliado" só se não houver nenhuma cotação com estrutura informada.

3. comparacao_opcoes_status / comparacao_opcoes_resumo — leitura comparativa entre as opções (ver também o array "opcoes" abaixo, que traz cada cotação em detalhe): qual se destaca, por quê, e o que se ganha/perde entre elas. Se houver LMIs diferentes, compare a proteção antes do preço. "nao_avaliado" se houver só uma opção no panorama (não há o que comparar) — nesse caso, diga isso e valorize a aprovação existente sem criar escassez artificial.

4. aprovacao_alternativas_status / aprovacao_alternativas_resumo — status de aprovação de cada opção (cotado/pré-aprovado/aprovado/pendente/recusado), registre recusas como dado do cenário (nunca como julgamento sobre o cliente), e trate título de capitalização como outra modalidade de garantia locatícia (nunca como "seguro") quando o panorama mencionar essa alternativa: aporte, prazo, forma de pagamento, regras de resgate/correção exatamente como informado, quando faz sentido e as limitações. Se não houver menção a capitalização, não é preciso comentar sobre isso. "problema" se todas as opções estiverem recusadas ou pendentes sem alternativa clara.

5. viabilidade_comercial_status / viabilidade_comercial_resumo — leitura final: essa proposta está dentro do que o mercado pratica, qual opção entrega o melhor equilíbrio e por quê (dados objetivos), e qual seria a alternativa para quem prioriza menor parcela ou proteção mais ampla. Se o caso tiver DDD ou região identificável e isso ajudar a prova social, use: Rio de Janeiro (DDD 21, 22, 24) → imobiliárias Real Up e Renascença; São Paulo (DDD 11) → Monte Alegre e Senador; outras regiões → marcas nacionais de peso. Só cite quando reforçar a argumentação, nunca force. "atencao" ou "problema" se o preço estiver fora do esperado sem justificativa clara no panorama (ex: perfil recusado em outras seguradoras, elevando o valor).

status_geral: "PRONTO_PARA_RECOMENDAR" se todos os pilares avaliados estão "ok" (os "nao_avaliado" não contam contra); "RECOMENDAR_COM_RESSALVAS" se houver "atencao" ou "problema" leve/pontual; "FALTAM_DADOS_ESSENCIAIS" se houver "problema" grave que impeça uma recomendação segura agora (ex: pacote não calculável, nenhuma opção com status de aprovação claro).

pontos_criticos: lista curta (pode ficar vazia) só com os dados que faltam confirmar antes de recomendar ou emitir, ou ressalvas graves — cada item em 1 frase, no formato "[dado] não informado — confirmar antes de recomendar ou emitir" quando for o caso.

opcoes: preencha uma entrada para cada cotação distinta do panorama (mesma seguradora com LMIs diferentes conta como opções separadas) — é o detalhe por trás do pilar 3.

proximo_passo: ação objetiva a combinar com o cliente/imobiliária — escolher plano, confirmar cobertura, enviar documento, emitir ou agendar retorno.

MENSAGEM PRONTA PARA WHATSAPP ("mensagem_whatsapp"):
- No máximo 4 blocos curtos, até ~600 caracteres no total.
- Comece acolhendo a objeção ou confirmando o ponto principal, sem introdução longa.
- Só os números que mudam a decisão: valor, percentual do pacote, diferença relevante.
- No máximo 3 caminhos reais (não liste todas as opções técnicas).
- Termine com uma única pergunta objetiva indicando a próxima ação.
- Use linguagem condicional ("depois de confirmado o credenciamento", "conforme as regras do título") para qualquer coisa ainda não confirmada documentalmente no panorama.
- Pode usar até um emoji quando fizer sentido pro tom, sem exagerar.

Se o panorama vier como imagem (print de tela do sistema/CRM/seguradora), leia os dados diretamente da imagem, exatamente como faria com texto — não presuma nada que não esteja visível.

Responda SEMPRE chamando a ferramenta "reportar_analise", preenchendo todos os campos do schema. Nunca responda em texto livre.`;

const STATUS_APROVACAO_ENUM = ["cotado", "pre_aprovado", "aprovado", "pendente", "recusado"];
const STATUS_PILAR_ENUM = ["ok", "atencao", "problema", "nao_avaliado"];

const FERRAMENTA_ANALISE: Anthropic.Tool = {
  name: "reportar_analise",
  description: "Reporta o parecer analítico em 5 pilares e a mensagem comercial de um panorama de cotações de seguro fiança.",
  input_schema: {
    type: "object",
    properties: {
      status_geral: {
        type: "string",
        enum: ["PRONTO_PARA_RECOMENDAR", "RECOMENDAR_COM_RESSALVAS", "FALTAM_DADOS_ESSENCIAIS"],
        description: "Veredito final considerando os 5 pilares do parecer.",
      },
      dados_caso_status: { type: "string", enum: STATUS_PILAR_ENUM, description: "Status do pilar 1 (dados do caso)." },
      dados_caso_resumo: { type: "string", minLength: 1, description: "Resumo do pilar 1 (dados do caso): pacote de locação, partes e urgência." },
      cobertura_estrutura_status: { type: "string", enum: STATUS_PILAR_ENUM, description: "Status do pilar 2 (cobertura e estrutura)." },
      cobertura_estrutura_resumo: {
        type: "string",
        minLength: 1,
        description: "Resumo do pilar 2: o que cada opção cobre (básico x completo) e a estrutura de limite (LMI x LMG), com a diferença entre planos quando houver os dois.",
      },
      comparacao_opcoes_status: { type: "string", enum: STATUS_PILAR_ENUM, description: "Status do pilar 3 (comparação entre opções)." },
      comparacao_opcoes_resumo: {
        type: "string",
        minLength: 1,
        description: "Resumo do pilar 3: leitura comparativa entre as opções, qual se destaca e por quê.",
      },
      aprovacao_alternativas_status: { type: "string", enum: STATUS_PILAR_ENUM, description: "Status do pilar 4 (aprovação e alternativas)." },
      aprovacao_alternativas_resumo: {
        type: "string",
        minLength: 1,
        description: "Resumo do pilar 4: status de aprovação de cada opção, recusas registradas como dado do cenário, e título de capitalização como alternativa quando mencionado no panorama.",
      },
      viabilidade_comercial_status: { type: "string", enum: STATUS_PILAR_ENUM, description: "Status do pilar 5 (viabilidade comercial)." },
      viabilidade_comercial_resumo: {
        type: "string",
        minLength: 1,
        description: "Resumo do pilar 5: leitura final justificada, melhor equilíbrio custo-proteção e alternativa por prioridade do cliente.",
      },
      pontos_criticos: {
        type: "array",
        description: "Dados essenciais faltando ou ressalvas graves a confirmar antes de recomendar ou emitir. Pode ficar vazio.",
        items: { type: "string" },
      },
      opcoes: {
        type: "array",
        description: "Uma entrada por cotação distinta recebida no panorama — detalhe por trás do pilar 3.",
        items: {
          type: "object",
          properties: {
            seguradora: { type: "string" },
            plano: { type: "string", description: "Ex: 'Básico', 'Completo', ou o nome comercial do produto." },
            estrutura: { type: "string", enum: ["LMI", "LMG", "nao_informado"] },
            multiplicador: { type: "string", description: "Ex: '30x', ou 'não informado'." },
            parcelas: { type: "string", description: "Ex: '12x', ou 'não informado'." },
            valor_parcela: { type: "string", description: "Ex: 'R$ 509,37'." },
            valor_total: { type: "string", description: "Valor da parcela × quantidade de parcelas (ou o prêmio total informado, se divergente)." },
            status_aprovacao: { type: "string", enum: STATUS_APROVACAO_ENUM },
            pontos_fortes: {
              type: "string",
              description: "O que essa opção entrega de melhor, em 1 frase — cite o percentual sobre o pacote de locação aqui quando for relevante.",
            },
            pontos_atencao: { type: "string", description: "Limitação, divergência de prêmio ou ressalva dessa opção, em 1 frase. Pode ficar vazio." },
          },
          required: [
            "seguradora",
            "plano",
            "estrutura",
            "multiplicador",
            "parcelas",
            "valor_parcela",
            "valor_total",
            "status_aprovacao",
            "pontos_fortes",
            "pontos_atencao",
          ],
        },
      },
      proximo_passo: {
        type: "string",
        minLength: 1,
        description: "Ação objetiva a combinar com o cliente/imobiliária: escolher plano, confirmar cobertura, enviar documento, emitir ou agendar retorno.",
      },
      mensagem_whatsapp: {
        type: "string",
        minLength: 1,
        description: "Mensagem curta pronta para enviar por WhatsApp, seguindo as regras de formato do manual.",
      },
    },
    required: [
      "status_geral",
      "dados_caso_status",
      "dados_caso_resumo",
      "cobertura_estrutura_status",
      "cobertura_estrutura_resumo",
      "comparacao_opcoes_status",
      "comparacao_opcoes_resumo",
      "aprovacao_alternativas_status",
      "aprovacao_alternativas_resumo",
      "viabilidade_comercial_status",
      "viabilidade_comercial_resumo",
      "pontos_criticos",
      "opcoes",
      "proximo_passo",
      "mensagem_whatsapp",
    ],
  },
};

function blocoDaEntrada(entrada: FonteEntrada): Anthropic.ContentBlockParam[] {
  if (entrada.tipo === "texto") {
    return [{ type: "text", text: `PANORAMA DO CASO:\n\n${entrada.texto}` }];
  }
  return [
    { type: "text", text: "PANORAMA DO CASO (imagem/print de tela anexado abaixo — leia o conteúdo visível na imagem):" },
    { type: "image", source: { type: "base64", media_type: entrada.mediaType, data: entrada.base64 } },
  ];
}

export async function analisarPanoramaFianca(entrada: FonteEntrada): Promise<AnaliseFianca> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Assistente de vendas não configurado: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_ANALISE],
    tool_choice: { type: "tool", name: "reportar_analise" },
    messages: [{ role: "user", content: blocoDaEntrada(entrada) }],
  });

  if (mensagem.stop_reason === "max_tokens") {
    throw new Error(
      "A análise deste panorama ficou grande demais e foi cortada pela IA antes de terminar. Tente novamente com um panorama mais enxuto (menos opções por vez)."
    );
  }

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) {
    throw new Error("A IA não retornou uma análise estruturada.");
  }

  return chamada.input as AnaliseFianca;
}
