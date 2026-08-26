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

export type MensagemGmail = {
  id: string;
  threadId: string;
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
      const msg = resposta.data;
      if (!msg.id || !msg.threadId) continue;
      mensagens.push({
        id: msg.id,
        threadId: msg.threadId,
        remetente: obterHeader(msg.payload?.headers, "From"),
        destinatarios: obterHeader(msg.payload?.headers, "To"),
        assunto: obterHeader(msg.payload?.headers, "Subject"),
        data: obterHeader(msg.payload?.headers, "Date"),
        snippet: msg.snippet || "",
        corpoTexto: extrairTextoPlano(msg.payload).slice(0, LIMITE_CORPO),
        labelIds: msg.labelIds || [],
      });
    }
  }
  return mensagens;
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
