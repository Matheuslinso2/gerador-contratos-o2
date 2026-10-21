import "server-only";
import { obterClienteGmail } from "@/lib/gestaoEmails/gmail";
import { createServiceClient } from "@/lib/supabase/service";
import { assuntoBase } from "./conversasEmail";

// Achar, no Gmail, a conversa que a equipe já está tendo com o cliente por
// fora do card (ex: o cliente escreveu direto pra fianca@ e a equipe
// respondeu pelo Gmail sem pôr o endereço do card em cópia -- caso real do
// card 3002, 21/10/2026). Usa a caixa que a Gestão de E-mails já lê
// (matheus@, que recebe tudo que vai pra fianca@): a conta de serviço tem o
// usuário fixo no código, nada aqui permite escolher outra caixa.
//
// Um mesmo endereço de imobiliária atende vários cards, então NÃO vinculamos
// sozinhos: a pessoa escolhe a conversa certa (uma vez) e o card fica
// vinculado -- dali em diante todo envio entra nela (conversasEmail.ts).

export type ConversaGmail = {
  threadId: string;
  assunto: string;
  assuntoBase: string;
  ultimaEm: string;
  mensagens: number;
  participantes: string;
  trecho: string;
};

const DIAS_BUSCA = 45;
const MAX_CONVERSAS = 8;
const EMAIL_REGEX = /^[^\s@()"']+@[^\s@()"']+\.[^\s@()"']+$/;

function cabecalho(headers: { name?: string | null; value?: string | null }[] | undefined, nome: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === nome.toLowerCase())?.value ?? "";
}

export async function buscarConversasGmail(enderecos: string[]): Promise<ConversaGmail[]> {
  // Só endereços de e-mail "limpos" entram na busca do Gmail -- nada de
  // operadores digitados pelo usuário.
  const limpos = [...new Set(enderecos.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_REGEX.test(e)))].slice(0, 6);
  if (!limpos.length) return [];
  const q = `(${limpos.map((e) => `from:${e} OR to:${e} OR cc:${e}`).join(" OR ")}) newer_than:${DIAS_BUSCA}d`;

  const gmail = obterClienteGmail();
  const lista = await gmail.users.threads.list({ userId: "me", q, maxResults: MAX_CONVERSAS });
  const resultado: ConversaGmail[] = [];
  for (const t of lista.data.threads ?? []) {
    if (!t.id) continue;
    const thread = await gmail.users.threads.get({
      userId: "me",
      id: t.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "To", "Date"],
    });
    const msgs = thread.data.messages ?? [];
    if (!msgs.length) continue;
    const primeira = msgs[0];
    const ultima = msgs[msgs.length - 1];
    const assunto = cabecalho(primeira.payload?.headers ?? [], "Subject") || "(sem assunto)";
    const nomes = new Set<string>();
    for (const m of msgs) {
      const de = cabecalho(m.payload?.headers ?? [], "From").replace(/<.*>/, "").replace(/"/g, "").trim();
      if (de) nomes.add(de);
    }
    resultado.push({
      threadId: t.id,
      assunto,
      assuntoBase: assuntoBase(assunto),
      ultimaEm: new Date(Number(ultima.internalDate ?? Date.now())).toISOString(),
      mensagens: msgs.length,
      participantes: [...nomes].slice(0, 4).join(", "),
      trecho: (ultima.snippet ?? "").slice(0, 140),
    });
  }
  return resultado.sort((a, b) => b.ultimaEm.localeCompare(a.ultimaEm));
}

// Vincula a conversa do Gmail ao card: guarda o Message-ID da ÚLTIMA mensagem
// (e a cadeia References) como a mensagem mais recente do card. O threadId vem
// do navegador, mas tudo o que é gravado é relido do Gmail aqui.
export async function vincularConversaGmail(entityTypeId: number, itemId: number, threadId: string): Promise<{ assuntoBase: string }> {
  const gmail = obterClienteGmail();
  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "metadata",
    metadataHeaders: ["Subject", "Message-ID", "References"],
  });
  const msgs = thread.data.messages ?? [];
  const ultima = msgs[msgs.length - 1];
  const messageId = cabecalho(ultima?.payload?.headers ?? [], "Message-ID").trim();
  if (!ultima || !messageId) throw new Error("Não consegui ler o identificador da conversa no Gmail.");
  const referencias = cabecalho(ultima.payload?.headers ?? [], "References").replace(/\s+/g, " ").trim() || null;
  const assunto = cabecalho(msgs[0].payload?.headers ?? [], "Subject") || "(sem assunto)";
  const base = assuntoBase(assunto);

  const { error } = await createServiceClient().from("bitrix_email_mensagens").upsert(
    {
      message_id: messageId,
      entity_type_id: entityTypeId,
      item_id: itemId,
      direcao: "recebido",
      remetente: "vinculado do Gmail",
      assunto,
      assunto_base: base,
      referencias,
      criado_em: new Date().toISOString(),
    },
    { onConflict: "entity_type_id,item_id,message_id" }
  );
  if (error) throw new Error(`Falha ao vincular a conversa: ${error.message}`);
  return { assuntoBase: base };
}
