import "server-only";

import { auth, gmail, gmail_v1 } from "@googleapis/gmail";

// Delegação em todo o domínio: a conta de serviço "gestao-emails-o2" foi
// autorizada no Google Admin (Segurança > Controles de API > Delegação em
// todo o domínio) só pros escopos abaixo -- mas ela pode, em tese,
// impersonar QUALQUER usuário do Workspace O2. O `subject` fixo abaixo é o
// que realmente restringe essa integração à caixa do Matheus: nunca deixar
// esse valor virar parâmetro vindo de fora.
const EMAIL_IMPERSONADO = "matheus@o2seguros.com.br";

const ESCOPOS = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];

function obterClienteGmail(): gmail_v1.Gmail {
  const email = process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const chavePrivada = process.env.GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !chavePrivada) {
    throw new Error(
      "Gestão de E-mails não configurada: faltam GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_EMAIL/GESTAO_EMAILS_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
    );
  }

  // JWT (não GoogleAuth genérico) porque só o JWT client aceita `subject`
  // pra impersonation via delegação de domínio -- é isso que faz a conta de
  // serviço agir "como" matheus@o2seguros.com.br em vez de como ela mesma.
  // Usa o JWT exportado pelo próprio @googleapis/gmail (não o pacote
  // google-auth-library da raiz) -- mesmo cuidado documentado em
  // src/lib/googleAuth.ts: versões transitivas diferentes da lib de auth
  // geram tipos incompatíveis entre si.
  const cliente = new auth.JWT({
    email,
    key: chavePrivada.replace(/\\n/g, "\n"),
    scopes: ESCOPOS,
    subject: EMAIL_IMPERSONADO,
  });

  return gmail({ version: "v1", auth: cliente });
}

// "to:" (não "in:inbox" sozinho) já implementa a regra "ignorar e-mail em
// que sou só copiado, sem tarefa atribuída" na própria busca -- o operador
// to: do Gmail só bate com o campo Para, nunca Cc. Confirmado num teste
// real: com in:inbox puro, o volume de notificação automática de equipe
// (Segimob, Fiança, Incêndio) lotava a amostra recente e engolia por
// completo os poucos e-mails que são de fato do Matheus.
export const QUERY_PADRAO_CAIXA_EXECUTIVA = "to:matheus@o2seguros.com.br in:inbox newer_than:7d";

export type MensagemGmail = {
  id: string;
  threadId: string;
  messageIdHeader: string;
  remetente: string;
  destinatarios: string;
  assunto: string;
  data: string;
  snippet: string;
  corpoTexto: string;
  labelIds: string[];
};

function decodificarBase64Url(dado: string): string {
  return Buffer.from(dado, "base64url").toString("utf-8");
}

// Percorre a árvore de partes MIME procurando texto puro; cai pro HTML cru
// só se não existir nenhuma parte text/plain (raro, mas evita corpo vazio).
function extrairTextoPlano(parte: gmail_v1.Schema$MessagePart | undefined): string {
  if (!parte) return "";
  if (parte.mimeType === "text/plain" && parte.body?.data) {
    return decodificarBase64Url(parte.body.data);
  }
  if (parte.parts?.length) {
    for (const filha of parte.parts) {
      const texto = extrairTextoPlano(filha);
      if (texto) return texto;
    }
  }
  if (parte.mimeType === "text/html" && parte.body?.data) {
    return decodificarBase64Url(parte.body.data);
  }
  return "";
}

function obterHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, nome: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === nome.toLowerCase())?.value || "";
}

// Busca em lotes pequenos -- a API do Gmail devolve 429 (rate limit) se a
// gente disparar dezenas de requisições `messages.get` de uma vez só.
const TAMANHO_LOTE = 8;

// Corpo cortado em 6000 caracteres: suficiente pra qualquer classificação
// (por IA ou por regra) sem inflar o payload da rota de teste/API nem o
// custo de token quando isso alimentar um prompt na Fase 3.
const LIMITE_CORPO = 6000;

export async function listarMensagens({
  query,
  maxResultados = 40,
}: {
  query: string;
  maxResultados?: number;
}): Promise<MensagemGmail[]> {
  const api = obterClienteGmail();

  const lista = await api.users.messages.list({
    userId: "me",
    q: query,
    maxResults: maxResultados,
  });
  const ids = (lista.data.messages || []).map((m) => m.id).filter((id): id is string => !!id);
  if (!ids.length) return [];

  const mensagens: MensagemGmail[] = [];
  for (let i = 0; i < ids.length; i += TAMANHO_LOTE) {
    const lote = ids.slice(i, i + TAMANHO_LOTE);
    const resultados = await Promise.all(
      lote.map((id) => api.users.messages.get({ userId: "me", id, format: "full" }))
    );
    for (const resposta of resultados) {
      const mensagem = paraMensagemGmail(resposta.data);
      if (mensagem) mensagens.push(mensagem);
    }
  }
  return mensagens;
}

function paraMensagemGmail(msg: gmail_v1.Schema$Message): MensagemGmail | null {
  if (!msg.id || !msg.threadId) return null;
  return {
    id: msg.id,
    threadId: msg.threadId,
    messageIdHeader: obterHeader(msg.payload?.headers, "Message-ID"),
    remetente: obterHeader(msg.payload?.headers, "From"),
    destinatarios: obterHeader(msg.payload?.headers, "To"),
    assunto: obterHeader(msg.payload?.headers, "Subject"),
    data: obterHeader(msg.payload?.headers, "Date"),
    snippet: msg.snippet || "",
    corpoTexto: extrairTextoPlano(msg.payload).slice(0, LIMITE_CORPO),
    labelIds: msg.labelIds || [],
  };
}

// Busca uma mensagem específica pelo id interno do Gmail -- usado pelas
// ações (arquivar, gerar rascunho) pra reobter o dado real da mensagem em
// vez de confiar em algo que o cliente guardou na tela.
export async function obterMensagemPorId(messageId: string): Promise<MensagemGmail | null> {
  const api = obterClienteGmail();
  const resposta = await api.users.messages.get({ userId: "me", id: messageId, format: "full" });
  return paraMensagemGmail(resposta.data);
}

// Arquivar = tirar a label INBOX (igual ao botão "Arquivar" do Gmail de
// verdade -- a mensagem continua existindo, só sai da caixa de entrada).
export async function arquivarMensagem(messageId: string): Promise<void> {
  const api = obterClienteGmail();
  await api.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["INBOX"] },
  });
}

function codificarAssuntoUtf8(assunto: string): string {
  // Cabeçalho de e-mail é ASCII -- assunto com acento precisa ir como
  // "encoded word" (RFC 2047), senão vira lixo no cliente de e-mail.
  return `=?UTF-8?B?${Buffer.from(assunto, "utf-8").toString("base64")}?=`;
}

function assuntoComRe(assuntoOriginal: string): string {
  return /^re:/i.test(assuntoOriginal.trim()) ? assuntoOriginal : `Re: ${assuntoOriginal}`;
}

// Cria um rascunho de resposta DE VERDADE no Gmail (não simulado) dentro da
// mesma thread do e-mail original -- o Matheus revisa e envia direto pelo
// Gmail. In-Reply-To/References é o que faz o Gmail (e o cliente de quem
// recebe) reconhecerem isso como resposta em vez de e-mail solto, mesmo já
// enviando `threadId` também.
export async function criarRascunhoResposta({
  mensagemOriginal,
  corpoTexto,
}: {
  mensagemOriginal: MensagemGmail;
  corpoTexto: string;
}): Promise<void> {
  const api = obterClienteGmail();

  const linhas = [
    `To: ${mensagemOriginal.remetente}`,
    `Subject: ${codificarAssuntoUtf8(assuntoComRe(mensagemOriginal.assunto))}`,
    mensagemOriginal.messageIdHeader ? `In-Reply-To: ${mensagemOriginal.messageIdHeader}` : null,
    mensagemOriginal.messageIdHeader ? `References: ${mensagemOriginal.messageIdHeader}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    corpoTexto,
  ].filter((linha): linha is string => linha !== null);

  const raw = Buffer.from(linhas.join("\r\n"), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await api.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw, threadId: mensagemOriginal.threadId },
    },
  });
}
