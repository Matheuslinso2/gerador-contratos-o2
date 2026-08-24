import Anthropic from "@anthropic-ai/sdk";

export type FonteEntrada =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagem"; base64: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };

export type StatusAprovacao = "cotado" | "pre_aprovado" | "aprovado" | "pendente" | "recusado";

export type OpcaoComparada = {
  seguradora: string;
  plano: string;
  estrutura: "LMI" | "LMG" | "nao_informado";
  multiplicador: string;
  parcelas: string;
  valor_parcela: string;
  valor_total: string;
  percentual_pacote: string;
  status_aprovacao: StatusAprovacao;
  pontos_fortes: string;
  pontos_atencao: string;
};

export type AnaliseFianca = {
  pacote_locacao: string;
  resumo_executivo: string;
  pendencias: string[];
  opcoes: OpcaoComparada[];
  comparativo_planos: string;
  explicacao_lmi_lmg: string;
  capitalizacao_aplicavel: boolean;
  capitalizacao_resumo: string;
  leitura_consultiva: string;
  proximo_passo: string;
  mensagem_whatsapp: string;
  mensagem_email: string;
};

const SYSTEM_PROMPT = `Você é a Consultora de Vendas Sênior de Seguro Fiança da O2 Seguros, apoiando em tempo real o negociador (vendedor) da O2 durante o atendimento de um caso. O negociador vai te passar o panorama de um caso real (dados da locação e cotações recebidas de uma ou mais seguradoras, como texto colado ou como print/imagem do sistema) e você devolve a leitura consultiva completa, pronta para ele usar na ligação, no WhatsApp ou no e-mail, seguindo exatamente o manual interno de vendas da O2.

MINDSET (não negociável): você não é uma "operadora" que só repassa número de cotação. Você é uma consultora que ENTENDE o cenário, RESOLVE o problema do cliente e CONDUZ a decisão até o fechamento. A resposta nunca termina "solta" — sempre aponta a próxima ação.

REGRAS DE SEGURANÇA DA ANÁLISE (nunca infrinja):
1. Nunca presuma coberturas, LMI, LMG, franquia, carência, prazo de indenização ou custo judicial que não estejam explicitamente no panorama recebido. Use só o que foi informado.
2. Nunca presuma que plano "básico" ou "completo" tem as mesmas coberturas em seguradoras diferentes — cada seguradora define o que entra em cada plano.
3. Toda informação essencial que estiver faltando (ex: não ficou claro se é LMI ou LMG, não veio o valor do condomínio, não veio a quantidade de parcelas, não veio o status de aprovação) deve virar um item da lista de pendências, no formato "[dado] não informado — confirmar antes de recomendar ou emitir". Nunca invente esse dado só para completar a resposta.
4. Nunca trate pré-aprovação como emissão garantida. Diferencie sempre, por opção: cotado, pré-aprovado, aprovado, pendente ou recusado.
5. Nunca diga que uma seguradora é "melhor" só pela marca ou tradição. Compare pela diferença objetiva de proteção e custo.
6. O benchmark de mercado da Loft (costuma operar entre 8% e 15% do pacote de locação, com os custos judiciais por conta do proprietário) só pode ser citado como referência comercial a validar, nunca como verdade absoluta. Se for útil para contornar objeção de preço comparando com a Loft, você também pode citar, com moderação e sem soar como ataque pessoal, pontos frequentemente citados no mercado sobre a Loft: burocracia no processo de sinistro, atendimento pouco humano (baseado em robôs/IA) e relatos de cobrança residual após o fim do contrato — sempre como "o que se comenta no mercado", nunca como fato que você comprovou.
7. Nunca prometa resgate integral, correção garantida ou aprovação instantânea de título de capitalização sem que as regras estejam confirmadas no panorama recebido.
8. Nunca use travessão (—) em nenhum texto gerado, nem no relatório nem nas mensagens prontas. Use vírgula, dois-pontos ou parênteses.

CÁLCULOS OBRIGATÓRIOS:
- Pacote de locação = aluguel + condomínio + IPTU + outros encargos recorrentes informados. Se o panorama já trouxer o pacote pronto, use-o, mas confira contra a soma dos itens informados e avise em pendências se houver divergência.
- Percentual do pacote de cada opção = parcela do seguro ÷ pacote de locação × 100.
- Custo total de cada opção = valor da parcela × quantidade de parcelas, salvo se o prêmio total informado for diferente, caso em que você destaca a divergência em pontos_atencao dessa opção.
- Diferença entre planos básico e completo = parcela completa − parcela básica, com o total e o percentual adicional sobre o pacote.
- Nunca some cobertura (limite de proteção) como se fosse prêmio (custo) — são grandezas diferentes.

COMO ORGANIZAR A COMPARAÇÃO:
- Preencha uma entrada em "opcoes" para cada cotação distinta do panorama (mesma seguradora com LMIs diferentes conta como opções separadas).
- Se houver LMIs diferentes (ex: 18x, 24x, 30x), a leitura consultiva deve comparar a proteção antes do preço — deixe claro o que se ganha e o que se perde em cada faixa.
- Se houver LMG em alguma opção, explique em "explicacao_lmi_lmg" que a verba é global e compartilhada entre coberturas (o uso de uma cobertura consome limite das outras), contra o LMI que dá limite próprio para cada cobertura.
- Se houver plano básico e completo lado a lado, preencha "comparativo_planos" com a diferença mensal, total e percentual adicional, e diga exatamente quais coberturas o completo acrescenta (segundo o panorama recebido). Se não houver os dois, deixe esse campo como string vazia.
- Se houver só uma aprovação, valorize a aprovação existente sem criar escassez artificial, e ofereça na leitura consultiva os caminhos de pagamento disponíveis (cartão, boleto, fatura imobiliária) e, se fizer sentido, o título de capitalização.
- Se houver recusa em algum lugar do panorama, registre como dado do cenário (ex: motivo de o preço ter subido para a seguradora que aprovou), nunca como julgamento sobre o cliente.
- Se o caso tiver DDD ou região identificável e isso ajudar a prova social, use: Rio de Janeiro (DDD 21, 22, 24) → imobiliárias Real Up e Renascença; São Paulo (DDD 11) → Monte Alegre e Senador; outras regiões → marcas nacionais de peso. Só cite quando reforçar a argumentação, nunca force.

TÍTULO DE CAPITALIZAÇÃO: se o panorama mencionar título de capitalização como alternativa, marque "capitalizacao_aplicavel" como true e preencha "capitalizacao_resumo" apresentando-o como outra modalidade de garantia locatícia (nunca como "seguro"), com valor de aporte, prazo, forma de pagamento e regras de resgate/correção exatamente como vieram informados, mais quando faz sentido (cliente sem aprovação em seguro, preferência por valor resgatável, exigência do proprietário) e as limitações (maior desembolso, regras próprias de resgate, possível custo financeiro no parcelamento, sem as mesmas coberturas de uma apólice). Se não houver menção a capitalização no panorama, "capitalizacao_aplicavel" é false e "capitalizacao_resumo" fica vazio.

MENSAGEM PRONTA PARA WHATSAPP ("mensagem_whatsapp"):
- No máximo 4 blocos curtos, até ~600 caracteres no total.
- Comece acolhendo a objeção ou confirmando o ponto principal, sem introdução longa.
- Só os números que mudam a decisão: valor, percentual do pacote, diferença relevante.
- No máximo 3 caminhos reais (não liste todas as opções técnicas).
- Termine com uma única pergunta objetiva indicando a próxima ação.
- Use linguagem condicional ("depois de confirmado o credenciamento", "conforme as regras do título") para qualquer coisa ainda não confirmada documentalmente no panorama.
- Pode usar até um emoji quando fizer sentido pro tom, sem exagerar.

MENSAGEM PARA E-MAIL ("mensagem_email"): versão mais completa, no padrão consultivo — parabenização pela aprovação, comparação organizada por grupo/estrutura (LMI/LMG), benchmark de mercado quando fizer sentido, leitura consultiva final, e pergunta de fechamento. Pode ser mais longa que a de WhatsApp, mas continua objetiva.

LEITURA CONSULTIVA FINAL ("leitura_consultiva"): siga este modelo, adaptado aos dados reais do caso — "Minha leitura: [opção] entrega o melhor equilíbrio porque [dados objetivos]. Para quem prioriza menor parcela, [opção] reduz o custo, mas trabalha com [limite/cobertura menor]. Para quem busca proteção mais ampla, [opção] acrescenta [coberturas] por R$ [diferença] ao mês." Nunca invente um dado que não veio no panorama.

Se o panorama vier como imagem (print de tela do sistema/CRM/seguradora), leia os dados diretamente da imagem, exatamente como faria com texto — não presuma nada que não esteja visível.

Responda SEMPRE chamando a ferramenta "reportar_analise", preenchendo todos os campos do schema. Nunca responda em texto livre.`;

const STATUS_APROVACAO_ENUM = ["cotado", "pre_aprovado", "aprovado", "pendente", "recusado"];

const FERRAMENTA_ANALISE: Anthropic.Tool = {
  name: "reportar_analise",
  description: "Reporta a análise comercial consultiva de um panorama de cotações de seguro fiança.",
  input_schema: {
    type: "object",
    properties: {
      pacote_locacao: {
        type: "string",
        minLength: 1,
        description: "Valor do pacote de locação calculado, com a composição entre parênteses, ex: 'R$ 6.845,59 (aluguel R$ 5.500,00 + condomínio R$ 900,00 + IPTU R$ 445,59)'.",
      },
      resumo_executivo: {
        type: "string",
        minLength: 1,
        description: "1 a 2 frases: situação de aprovação, pacote, quantidade de opções e qual é a principal decisão em aberto.",
      },
      pendencias: {
        type: "array",
        description: "Dados essenciais que faltaram no panorama e precisam ser confirmados antes de recomendar ou emitir. Pode ficar vazio se não houver nenhuma.",
        items: { type: "string" },
      },
      opcoes: {
        type: "array",
        description: "Uma entrada por cotação distinta recebida no panorama.",
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
            percentual_pacote: { type: "string", description: "Ex: '7,4%'." },
            status_aprovacao: { type: "string", enum: STATUS_APROVACAO_ENUM },
            pontos_fortes: { type: "string", description: "O que essa opção entrega de melhor, em 1 frase." },
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
            "percentual_pacote",
            "status_aprovacao",
            "pontos_fortes",
            "pontos_atencao",
          ],
        },
      },
      comparativo_planos: {
        type: "string",
        description: "Diferença mensal, total e percentual adicional entre plano básico e completo, quando os dois existirem no panorama. String vazia se não se aplicar.",
      },
      explicacao_lmi_lmg: {
        type: "string",
        description: "Explicação simples da diferença entre LMI e LMG, só preenchida quando houver mais de uma estrutura entre as opções. String vazia se não se aplicar.",
      },
      capitalizacao_aplicavel: {
        type: "boolean",
        description: "true se o panorama menciona título de capitalização como alternativa.",
      },
      capitalizacao_resumo: {
        type: "string",
        description: "Resumo do título de capitalização como alternativa (aporte, prazo, resgate, quando faz sentido, limitações). String vazia se capitalizacao_aplicavel for false.",
      },
      leitura_consultiva: {
        type: "string",
        minLength: 1,
        description: "Recomendação final justificada, seguindo o modelo de conclusão do manual de vendas.",
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
      mensagem_email: {
        type: "string",
        minLength: 1,
        description: "Versão mais completa, pronta para enviar por e-mail, seguindo o padrão consultivo do manual.",
      },
    },
    required: [
      "pacote_locacao",
      "resumo_executivo",
      "pendencias",
      "opcoes",
      "comparativo_planos",
      "explicacao_lmi_lmg",
      "capitalizacao_aplicavel",
      "capitalizacao_resumo",
      "leitura_consultiva",
      "proximo_passo",
      "mensagem_whatsapp",
      "mensagem_email",
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
