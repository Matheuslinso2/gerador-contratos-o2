import Anthropic from "@anthropic-ai/sdk";
import type { MensagemGmail } from "./gmail";

// Mesmas 4 categorias definidas pelo Matheus pra triagem executiva da caixa
// dele -- "ruido" é tudo que fica de fora (operacional de equipe, newsletter,
// cópia sem tarefa atribuída). Ver system prompt abaixo pra critério completo.
export type CategoriaEmailExecutivo = "gestao_macro" | "api_seguradoras" | "contabil_pf" | "demanda_direta" | "ruido";

export type StatusEmailExecutivo = "urgente" | "aguardando_acao" | "em_andamento" | "informativo";

export type ClassificacaoEmailExecutivo = {
  messageId: string;
  categoria: CategoriaEmailExecutivo;
  resumoExecutivo: string | null;
  acaoExigida: string | null;
  status: StatusEmailExecutivo | null;
};

const SYSTEM_PROMPT = `Você filtra a caixa de entrada de matheus@o2seguros.com.br (dono/corretor da O2 Seguros, corretora de seguros imobiliários) pra identificar SÓ os e-mails que são responsabilidade DIRETA dele, dentro de 4 categorias:

- "gestao_macro": gestão macro da O2 Seguros -- financeiro/estratégico da empresa como um todo (ex: relatório de inadimplência consolidado endereçado a ele, decisão que afeta a corretora inteira), NÃO um caso operacional pontual de um cliente.
- "api_seguradoras": integração de APIs com seguradoras.
- "contabil_pf": questões contábeis, tributárias e fiscais -- da Pessoa Física dele, ou da empresa quando endereçadas diretamente a ele (contador, portal contábil, nota fiscal, cobrança de serviço usado pela empresa).
- "demanda_direta": solicitação ou obrigação endereçada diretamente a ELE, que exige uma ação/resposta PESSOAL dele -- alguém perguntando algo só pra ele, pedindo uma decisão dele, ou cobrando algo dele especificamente.

Use "ruido" pra tudo o resto, incluindo SEMPRE:
- E-mails operacionais do dia a dia das equipes (Fiança, Incêndio, cobrança, comercial) endereçados a caixas de equipe (fianca@, incendio@, cobranca@, comercial@, re@, financeiro@) mesmo que matheus@ apareça em cópia -- a equipe já está tratando, isso NÃO é dele.
- Notificações automáticas de sistemas internos (Segimob, Google Forms, biometria, cron) que não pedem nada dele.
- Newsletters, comunicados de seguradoras/fornecedores sem ação exigida, promoções, redes sociais, resumos automáticos (Monday, Read AI, LinkedIn, etc.), spam.
- E-mails em que ele está só em cópia, sem nenhuma tarefa atribuída especificamente a ele.

Critério de desempate quando bater a dúvida: pergunte "isso está pedindo uma decisão, aprovação ou resposta QUE SÓ O MATHEUS PODE DAR, ou é só ele acompanhando/copiado no que a equipe já está resolvendo?" -- só o primeiro caso é relevante (não "ruido").

Pra cada e-mail com categoria diferente de "ruido", preencha também:
- resumo_executivo: no máximo 2 frases, direto ao ponto, sobre o teor real da mensagem.
- acao_exigida: o que se espera que o Matheus faça (ou "Nenhuma -- apenas ciência" se for só informativo).
- status: "urgente" (prazo curto ou já atrasado), "aguardando_acao" (precisa de resposta/decisão dele, sem urgência extrema), "em_andamento" (ele já está envolvido, só acompanhando o desenrolar) ou "informativo" (não exige ação real, só ciência -- ex: recibo, confirmação de conclusão de serviço).

Pra e-mails "ruido", deixe resumo_executivo, acao_exigida e status como null.

Responda SEMPRE chamando a ferramenta "classificar_emails_executivos", com uma entrada pra CADA e-mail da lista recebida (mesmo message_id, na mesma ordem, sem pular nenhum).`;

const FERRAMENTA_CLASSIFICACAO: Anthropic.Tool = {
  name: "classificar_emails_executivos",
  description: "Classifica um lote de e-mails da caixa de matheus@o2seguros.com.br segundo as regras de triagem executiva da O2 Seguros.",
  input_schema: {
    type: "object",
    properties: {
      classificacoes: {
        type: "array",
        description: "Uma entrada por e-mail recebido, na mesma ordem, sem pular nenhum.",
        items: {
          type: "object",
          properties: {
            message_id: { type: "string", description: "Igual ao message_id recebido pra esse e-mail." },
            categoria: {
              type: "string",
              enum: ["gestao_macro", "api_seguradoras", "contabil_pf", "demanda_direta", "ruido"],
            },
            resumo_executivo: { type: ["string", "null"], description: "Máx. 2 frases. Null se categoria for ruido." },
            acao_exigida: { type: ["string", "null"], description: "Null se categoria for ruido." },
            status: {
              type: ["string", "null"],
              enum: ["urgente", "aguardando_acao", "em_andamento", "informativo", null],
              description: "Null se categoria for ruido.",
            },
          },
          required: ["message_id", "categoria", "resumo_executivo", "acao_exigida", "status"],
        },
      },
    },
    required: ["classificacoes"],
  },
};

// Corpo cortado bem mais que o limite de armazenagem em MensagemGmail --
// classificar não precisa do e-mail inteiro, e cada caractere a mais aqui é
// multiplicado por dezenas de e-mails no mesmo prompt em lote.
const LIMITE_CORPO_PROMPT = 900;

// Lotes pequenos: mantém o prompt (e o tempo de resposta) previsível mesmo
// quando a caixa tem muitos e-mails, e limita o estrago de uma classificação
// ruim isolada a só esse lote.
const TAMANHO_LOTE = 20;

function montarBlocoEmail(mensagem: MensagemGmail): string {
  return [
    `--- E-MAIL ${mensagem.id} ---`,
    `De: ${mensagem.remetente}`,
    `Para: ${mensagem.destinatarios}`,
    `Assunto: ${mensagem.assunto}`,
    `Data: ${mensagem.data}`,
    `Corpo:`,
    mensagem.corpoTexto.slice(0, LIMITE_CORPO_PROMPT),
  ].join("\n");
}

const CATEGORIAS_VALIDAS = new Set<CategoriaEmailExecutivo>([
  "gestao_macro",
  "api_seguradoras",
  "contabil_pf",
  "demanda_direta",
  "ruido",
]);

const STATUS_VALIDOS = new Set<StatusEmailExecutivo>(["urgente", "aguardando_acao", "em_andamento", "informativo"]);

function normalizarTexto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
}

function normalizarClassificacao(bruto: Record<string, unknown>): ClassificacaoEmailExecutivo | null {
  const messageId = typeof bruto.message_id === "string" ? bruto.message_id : null;
  if (!messageId) return null;

  const categoria = CATEGORIAS_VALIDAS.has(bruto.categoria as CategoriaEmailExecutivo)
    ? (bruto.categoria as CategoriaEmailExecutivo)
    : "ruido";

  if (categoria === "ruido") {
    return { messageId, categoria, resumoExecutivo: null, acaoExigida: null, status: null };
  }

  const status = STATUS_VALIDOS.has(bruto.status as StatusEmailExecutivo) ? (bruto.status as StatusEmailExecutivo) : null;

  return {
    messageId,
    categoria,
    resumoExecutivo: normalizarTexto(bruto.resumo_executivo),
    acaoExigida: normalizarTexto(bruto.acao_exigida),
    status,
  };
}

async function classificarLote(lote: MensagemGmail[], anthropic: Anthropic): Promise<ClassificacaoEmailExecutivo[]> {
  if (!lote.length) return [];

  const mensagem = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [FERRAMENTA_CLASSIFICACAO],
    tool_choice: { type: "tool", name: "classificar_emails_executivos" },
    messages: [
      {
        role: "user",
        content: `Classifique os ${lote.length} e-mails abaixo:\n\n${lote.map(montarBlocoEmail).join("\n\n")}`,
      },
    ],
  });

  const chamada = mensagem.content.find((bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use");
  if (!chamada) throw new Error("A IA não retornou uma classificação estruturada do lote de e-mails.");

  const bruto = (chamada.input as { classificacoes?: unknown[] }).classificacoes ?? [];
  const classificadas = new Map<string, ClassificacaoEmailExecutivo>();
  for (const item of bruto) {
    const normalizado = normalizarClassificacao(item as Record<string, unknown>);
    if (normalizado) classificadas.set(normalizado.messageId, normalizado);
  }

  // Qualquer e-mail do lote que a IA não tenha devolvido (raro, mas acontece
  // quando o modelo esquece um item de uma lista longa) vira "ruido" por
  // padrão -- nunca deve aparecer como acionável sem ter sido classificado.
  return lote.map(
    (item) =>
      classificadas.get(item.id) ?? {
        messageId: item.id,
        categoria: "ruido" as const,
        resumoExecutivo: null,
        acaoExigida: null,
        status: null,
      }
  );
}

export async function classificarEmailsExecutivos(mensagens: MensagemGmail[]): Promise<ClassificacaoEmailExecutivo[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Classificação de e-mails não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }
  if (!mensagens.length) return [];

  const anthropic = new Anthropic({ apiKey });
  const resultado: ClassificacaoEmailExecutivo[] = [];

  for (let i = 0; i < mensagens.length; i += TAMANHO_LOTE) {
    const lote = mensagens.slice(i, i + TAMANHO_LOTE);
    resultado.push(...(await classificarLote(lote, anthropic)));
  }

  return resultado;
}
