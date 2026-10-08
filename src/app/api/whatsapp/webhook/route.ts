import { NextRequest, NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarTextoWhatsApp } from "@/lib/whatsapp";
import { buscarContato, type ContatoWhatsApp } from "@/lib/whatsappContatos";
import { responderPerguntaWhatsApp } from "@/lib/whatsappAssistente";

export const dynamic = "force-dynamic";
// A resposta da IA roda em after() -- depois de devolver 200 pra Meta --
// e ainda conta dentro deste limite.
export const maxDuration = 60;

// Webhook do WhatsApp (Cloud API) -- recebe as mensagens que chegam no
// número do relatório diário e responde com a IA (Fase 1 de 07/10/2026,
// ver lib/whatsappAssistente.ts). Configurado no painel da Meta: app
// "Workspace O2" > WhatsApp > Configuração > Webhook, URL
// https://contratos.o2seguros.com.br/api/whatsapp/webhook, campo "messages".
//
// Variáveis no Vercel:
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN  texto combinado com a Meta na hora de
//                                  cadastrar o webhook (GET de verificação)
//   WHATSAPP_APP_SECRET            "Chave secreta do app" (Configurações do
//                                  app > Básico) -- valida a assinatura
//                                  X-Hub-Signature-256 de cada POST

// Verificação inicial: a Meta chama com hub.challenge e espera o mesmo
// valor de volta se o verify_token bater.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const esperado = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (esperado && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === esperado) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ erro: "verificação recusada" }, { status: 403 });
}

function assinaturaValida(corpoCru: string, cabecalho: string | null, segredo: string): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const recebida = Buffer.from(cabecalho.slice(7), "hex");
  const esperada = createHmac("sha256", segredo).update(corpoCru).digest();
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

type MensagemMeta = { id: string; from: string; type: string; text?: { body?: string } };
type EventoMeta = { entry?: { changes?: { value?: { messages?: MensagemMeta[] } }[] }[] };

async function processar(m: MensagemMeta, contato: ContatoWhatsApp) {
  const supabase = createServiceClient();
  const texto = m.type === "text" ? (m.text?.body ?? "").trim() : null;

  // A Meta reenvia o evento se não respondermos rápido -- o id é a chave
  // primária, então a segunda entrega do mesmo evento não insere nada.
  const { data: inserida } = await supabase
    .from("whatsapp_mensagens")
    .upsert({ id: m.id, numero: m.from, texto: texto ?? `[${m.type}]` }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (!inserida?.length) return;

  let resposta: string;
  let erro: string | null = null;
  if (!texto) {
    resposta = "Por enquanto eu só entendo mensagens de texto. Me mande a pergunta escrita. 🙂";
  } else if (contato.tipo === "imobiliaria") {
    // Fase C (atendimento às imobiliárias, só com os dados da própria
    // imobiliária) ainda não está pronta -- NUNCA cai na IA da equipe, que
    // enxerga o Workspace inteiro.
    resposta = "Olá! Em breve você vai poder consultar por aqui as informações da sua imobiliária com a O2 Seguros. Por enquanto, fale com a nossa equipe pelo atendimento de sempre.";
  } else {
    try {
      resposta = await responderPerguntaWhatsApp(m.from, m.id, texto);
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
      console.error("WhatsApp: falha ao gerar resposta:", e);
      resposta = "Tive um problema pra consultar o Workspace agora. Tente de novo em alguns minutos.";
    }
  }

  const envio = await enviarTextoWhatsApp(m.from, resposta);
  if (!envio.ok) erro = [erro, `envio: ${envio.erro}`].filter(Boolean).join(" | ");
  await supabase
    .from("whatsapp_mensagens")
    .update({ resposta, erro, respondida_em: new Date().toISOString() })
    .eq("id", m.id);
}

export async function POST(request: NextRequest) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) return NextResponse.json({ erro: "webhook não configurado" }, { status: 501 });

  const corpoCru = await request.text();
  if (!assinaturaValida(corpoCru, request.headers.get("x-hub-signature-256"), segredo)) {
    // Mais provável: WHATSAPP_APP_SECRET de outro app (há 2 "Workspace O2").
    console.warn("WhatsApp webhook: assinatura inválida -- conferir WHATSAPP_APP_SECRET");
    return NextResponse.json({ erro: "assinatura inválida" }, { status: 401 });
  }

  let evento: EventoMeta;
  try {
    evento = JSON.parse(corpoCru);
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Também chegam eventos de status (entregue/lido) do relatório -- sem
  // "messages", são ignorados. Número fora do cadastro (whatsapp_contatos): ignora em silêncio
  // (dados internos da O2).
  const recebidas = (evento.entry ?? []).flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []);
  const mensagens: { m: MensagemMeta; contato: ContatoWhatsApp }[] = [];
  for (const m of recebidas) {
    const contato = await buscarContato(m.from);
    if (contato) mensagens.push({ m, contato });
    else console.warn(`WhatsApp webhook: número fora do cadastro (…${m.from.slice(-4)}, ${m.from.length} dígitos) -- ignorado`);
  }
  if (mensagens.length) console.info(`WhatsApp webhook: ${mensagens.length} mensagem(ns) autorizada(s)`);

  // Responde 200 na hora (a Meta espera resposta rápida) e gera a resposta
  // da IA depois.
  if (mensagens.length) {
    after(async () => {
      for (const { m, contato } of mensagens) await processar(m, contato);
    });
  }
  return NextResponse.json({ ok: true });
}
