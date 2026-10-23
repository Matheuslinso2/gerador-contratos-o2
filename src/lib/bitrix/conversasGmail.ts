import "server-only";
import { obterClienteGmail, REMETENTES_EXCLUIDOS } from "@/lib/gestaoEmails/gmail";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarItem, chamarBitrix } from "./client";
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
  // Bate com o comentário "TRATATIVA: ..." do card (ver lerTratativaDoCard).
  sugerida: boolean;
};

const mesmoAssunto = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A equipe anota no card o nome da conversa de origem num comentário do tipo
// "TRATATIVA: BOA TARDE" (visto no card 3002, 21/10/2026). Devolve o assunto
// do comentário mais recente nesse formato, ou null.
export async function lerTratativaDoCard(entityTypeId: number, itemId: number): Promise<string | null> {
  const tipo = entityTypeId === 1 ? "lead" : entityTypeId === 2 ? "deal" : `dynamic_${entityTypeId}`;
  try {
    const r = await chamarBitrix<{ result: { COMMENT?: string; CREATED?: string }[] }>("crm.timeline.comment.list", {
      "filter[ENTITY_ID]": itemId,
      "filter[ENTITY_TYPE]": tipo,
      "select[]": ["ID", "COMMENT", "CREATED"],
    } as never);
    const achados = (r.result ?? [])
      .map((c) => ({ criado: c.CREATED ?? "", assunto: /^\s*TRATATIVA\s*:\s*(.+)$/im.exec(c.COMMENT ?? "")?.[1]?.trim() ?? "" }))
      .filter((c) => c.assunto)
      .sort((a, b) => a.criado.localeCompare(b.criado));
    return achados.length ? assuntoBase(achados[achados.length - 1].assunto) : null;
  } catch (erro) {
    console.warn("Falha ao ler comentários do card pra achar a tratativa:", erro);
    return null;
  }
}

const DIAS_BUSCA = 45;
const MAX_CONVERSAS = 12;
// Busca por palavra do assunto (campo da tela): vai mais longe no tempo e traz mais conversas.
const DIAS_BUSCA_TEXTO = 180;
const MAX_CONVERSAS_TEXTO = 30;
const EMAIL_REGEX = /^[^\s@()"']+@[^\s@()"']+\.[^\s@()"']+$/;

// O snippet do Gmail vem com entidades HTML ("&lt;", "&#39;"): a tela mostra
// como texto puro, então desfaz aqui.
function desescaparHtml(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function cabecalho(headers: { name?: string | null; value?: string | null }[] | undefined, nome: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === nome.toLowerCase())?.value ?? "";
}

export async function buscarConversasGmail(enderecos: string[], tratativa: string | null = null, texto = ""): Promise<ConversaGmail[]> {
  // Só endereços de e-mail "limpos" entram na busca do Gmail -- nada de
  // operadores digitados pelo usuário.
  const limpos = [...new Set(enderecos.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_REGEX.test(e)))].slice(0, 6);
  if (!limpos.length) return [];
  // Notificações automáticas (Segimob, seguradoras -- as mesmas que a Gestão
  // de E-mails já ignora) apareciam em massa e empurravam a conversa de
  // verdade pra fora da lista (card 994, 22/10/2026: a "Votação seguro
  // incêndio Ref.128/07" ficou em 10º atrás das "Nova observação no Fiança").
  const exclusoes = [...REMETENTES_EXCLUIDOS, "cartacobranca@tokiomarine.com.br"].map((r) => `-from:${r}`).join(" ");
  // Texto digitado na tela: só letras, números e pontuação simples, sempre como
  // frase entre aspas (nada de operador do Gmail) e sempre dentro das conversas
  // do destinatário.
  const frase = texto.normalize("NFC").replace(/[^\p{L}\p{N} .,_#/&()-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const dias = frase ? DIAS_BUSCA_TEXTO : DIAS_BUSCA;
  const q = `(${limpos.map((e) => `from:${e} OR to:${e} OR cc:${e}`).join(" OR ")}) newer_than:${dias}d ${exclusoes} -subject:"[Seg Imob]"${frase ? ` "${frase}"` : ""}`;

  const gmail = obterClienteGmail();
  const lista = await gmail.users.threads.list({ userId: "me", q, maxResults: frase ? MAX_CONVERSAS_TEXTO : MAX_CONVERSAS });
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
      trecho: desescaparHtml(ultima.snippet ?? "").slice(0, 140),
      sugerida: Boolean(tratativa) && mesmoAssunto(assuntoBase(assunto), tratativa!),
    });
  }
  // A sugerida (bate com o "TRATATIVA:" do card) vem primeiro; o resto, da mais recente pra mais antiga.
  return resultado.sort((a, b) => Number(b.sugerida) - Number(a.sugerida) || b.ultimaEm.localeCompare(a.ultimaEm));
}

// Chamado antes de cada envio: se o card tem comentário "TRATATIVA: X" e a
// conversa mais recente registrada dele não é a X, procura no Gmail a conversa
// X entre as do destinatário e vincula. Silencioso: se algo falhar, o envio
// segue na conversa que já estiver registrada (ou abre uma nova).
export async function vincularPorTratativa(entityTypeId: number, itemId: number, destinatarios: string[]): Promise<void> {
  try {
    const tratativa = await lerTratativaDoCard(entityTypeId, itemId);
    const { data: ultima } = await createServiceClient()
      .from("bitrix_email_mensagens")
      .select("assunto_base")
      .eq("entity_type_id", entityTypeId)
      .eq("item_id", itemId)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!tratativa) {
      // Sem comentário e sem nenhuma conversa registrada: é o 1º e-mail do card.
      // Se a equipe já conversava por fora (card 3122, 23/10/2026: o comercial
      // abriu "NOVA COTAÇÃO <nome>" e o 1º envio do card abriu outra), acha a
      // conversa pelo nome do card.
      if (!ultima) await vincularPorNomeDoCard(entityTypeId, itemId, destinatarios);
      return;
    }
    if (ultima && mesmoAssunto(ultima.assunto_base, tratativa)) return;
    const candidatas = (await buscarConversasGmail(destinatarios, tratativa)).filter((c) => c.sugerida);
    if (!candidatas.length) return;
    await vincularConversaGmail(entityTypeId, itemId, candidatas[0].threadId);
  } catch (erro) {
    console.warn("Falha ao vincular a conversa pela tratativa do card:", erro);
  }
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Só roda no 1º e-mail do card. O nome vem do título do card (parte antes de
// " - " ou "("), precisa ter 2+ palavras (nada de "BOA TARDE" solto) e aparecer
// no assunto da conversa. Se houver mais de uma conversa assim, não chuta:
// deixa o envio abrir a conversa nova (a pessoa ainda pode vincular pelo botão).
async function vincularPorNomeDoCard(entityTypeId: number, itemId: number, destinatarios: string[]): Promise<void> {
  const item = await buscarItem(entityTypeId, itemId);
  const nome = semAcento((item.title ?? "").split(/\s+-\s+|\(/)[0]);
  if (nome.split(" ").filter((p) => p.length >= 2).length < 2) return;
  const candidatas = (await buscarConversasGmail(destinatarios)).filter((c) => semAcento(c.assunto).includes(nome));
  if (candidatas.length !== 1) {
    if (candidatas.length > 1) console.warn(`Card ${itemId}: ${candidatas.length} conversas do Gmail com o nome "${nome}", não vinculei sozinho.`);
    return;
  }
  await vincularConversaGmail(entityTypeId, itemId, candidatas[0].threadId);
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
