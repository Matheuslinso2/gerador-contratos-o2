import Anthropic from "@anthropic-ai/sdk";

export type CategoriaPost = "mercado_imobiliario" | "seguro_imobiliario" | "institucional";

export type TipoPost =
  | "dica_mercado"
  | "atualizacao_tecnologia"
  | "apresentacao_produto"
  | "dado_mercado"
  | "autoridade_pessoal";

export type ConteudoGerado = {
  titulo_card: string;
  legenda: string;
  tipo_post: TipoPost;
  numero_destaque: string | null;
};

// Mesmo padrão de schema achatado + tool_choice forçado usado em
// faturasIA.ts e auditorContrato.ts — garante resposta estruturada sem
// depender de parsing de texto livre.
const FERRAMENTA_POST: Anthropic.Tool = {
  name: "gerar_post",
  description: "Reporta o texto de um post pronto pra publicar no Instagram, já classificado no layout visual certo.",
  input_schema: {
    type: "object",
    properties: {
      titulo_card: {
        type: "string",
        description: "Frase curta (até 70 caracteres) pra estampar na imagem do post — o gancho principal, não um resumo genérico.",
      },
      legenda: {
        type: "string",
        description: "Legenda completa do post, pronta pra publicar, incluindo as hashtags no fim.",
      },
      tipo_post: {
        type: "string",
        enum: [
          "dica_mercado",
          "atualizacao_tecnologia",
          "apresentacao_produto",
          "dado_mercado",
          "autoridade_pessoal",
        ],
        description:
          "Qual dos 5 layouts visuais combina com esse post: " +
          "dica_mercado = insight/orientação prática (ex: como avaliar um inquilino, o que olhar num contrato); " +
          "atualizacao_tecnologia = novidade de proptech/insurtech, automação, digitalização do setor; " +
          "apresentacao_produto = post institucional destacando um produto da O2 (Seguro Fiança, Incêndio, Capitalização etc.); " +
          "dado_mercado = a notícia tem um número/estatística forte que vale destacar em tamanho grande (só use se houver um número claro no material); " +
          "autoridade_pessoal = opinião/comentário pessoal do Matheus como especialista, sem um número ou produto específico em destaque.",
      },
      numero_destaque: {
        type: ["string", "null"],
        description:
          "Preencha SOMENTE quando tipo_post = dado_mercado: o número/estatística em si, bem curto e formatado pra ficar grande na imagem (ex: \"35%\", \"R$ 853 mi\", \"2 em cada 3\"). Nos outros casos, null.",
      },
    },
    required: ["titulo_card", "legenda", "tipo_post", "numero_destaque"],
  },
};

const VOZ = `Você escreve como Matheus, sócio-diretor da O2 Seguros (corretora especializada em seguros imobiliários, atua como departamento de seguros terceirizado de imobiliárias parceiras). O post é para o perfil PESSOAL dele no Instagram — não é a conta institucional da empresa.

Tom: especialista comentando o assunto em primeira pessoa, direto, sem soar como anúncio publicitário ou nota de assessoria de imprensa. Pode citar a O2 naturalmente quando fizer sentido (ex: "na O2 a gente vê isso o tempo todo"), mas o post não é propaganda da empresa.

Regras rígidas:
- NUNCA invente dado, número ou fato que não esteja no material fornecido.
- NUNCA copie frases inteiras da fonte — reescreva com as próprias palavras, no máximo uma citação curta entre aspas se necessário.
- NUNCA dê recomendação de investimento personalizada nem aconselhamento jurídico específico — comente o cenário, não diga o que "você deveria fazer com seu dinheiro".
- NUNCA use números internos da O2 (produção, comissão, nomes de clientes) — esse post é público.
- Termine a legenda com 3 a 6 hashtags relevantes em português (ex: #SeguroFiança #MercadoImobiliário).
- Legenda entre 400 e 900 caracteres, parágrafos curtos, sem emoji em excesso (no máximo 2-3).`;

async function chamarClaude(mensagemUsuario: string): Promise<ConteudoGerado> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Geração de conteúdo não configurada: falta ANTHROPIC_API_KEY.");

  const anthropic = new Anthropic({ apiKey });
  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1200,
    system: VOZ,
    tools: [FERRAMENTA_POST],
    tool_choice: { type: "tool", name: "gerar_post" },
    messages: [{ role: "user", content: mensagemUsuario }],
  });

  const chamada = mensagem.content.find(
    (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use"
  );
  if (!chamada) throw new Error("A IA não retornou o post estruturado.");
  return chamada.input as ConteudoGerado;
}

export async function gerarConteudoDeNoticia(noticia: {
  titulo: string;
  resumo: string | null;
  link: string;
  fonteNome: string;
}): Promise<ConteudoGerado> {
  return chamarClaude(
    `Escreva um post comentando esta notícia:\n\nFonte: ${noticia.fonteNome}\nTítulo: ${noticia.titulo}\nResumo: ${noticia.resumo ?? "(sem resumo, use só o título)"}\nLink: ${noticia.link}\n\nComente o que essa notícia significa pra quem trabalha com locação/seguro imobiliário, na sua visão como especialista. Não repita o resumo literalmente, dê um ângulo.`
  );
}

export async function gerarConteudoInstitucional(tema: string): Promise<ConteudoGerado> {
  return chamarClaude(
    `Escreva um post sobre este tema, do ponto de vista de especialista em seguros imobiliários:\n\n${tema}\n\nNão é uma notícia específica — é conteúdo de autoridade/dica, mas ainda assim sem inventar dados ou números que não foram fornecidos aqui.`
  );
}
