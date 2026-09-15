import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// Métricas de abertura/clique (pedido da reunião de 15/09/2026) -- Resend
// notifica esse endpoint quando alguém abre ou clica um e-mail de
// campanha. Precisa ser configurado manualmente no dashboard do Resend
// (Webhooks > Add Endpoint, eventos "email.opened" e "email.clicked",
// apontando pra .../api/campanhas/webhook-resend) -- o "Signing Secret"
// gerado lá vai na env var CAMPANHAS_RESEND_WEBHOOK_SECRET no Vercel.
//
// Verificação de assinatura segue o esquema Svix (usado pelo Resend):
// conteúdo assinado é "{svix-id}.{svix-timestamp}.{corpo cru}", HMAC-SHA256
// com a parte depois de "whsec_" do secret (decodificada de base64),
// comparado contra os valores "v1,<assinatura>" do header svix-signature.
const TOLERANCIA_TIMESTAMP_SEGUNDOS = 5 * 60;

function verificarAssinatura(corpoCru: string, svixId: string, svixTimestamp: string, svixSignature: string, secret: string): boolean {
  const timestampMs = Number(svixTimestamp) * 1000;
  if (!timestampMs || Math.abs(Date.now() - timestampMs) > TOLERANCIA_TIMESTAMP_SEGUNDOS * 1000) return false;

  const chaveBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const conteudoAssinado = `${svixId}.${svixTimestamp}.${corpoCru}`;
  const esperada = createHmac("sha256", chaveBytes).update(conteudoAssinado).digest("base64");
  const esperadaBuf = Buffer.from(esperada, "base64");

  return svixSignature
    .split(" ")
    .map((par) => par.split(",")[1])
    .filter(Boolean)
    .some((recebida) => {
      const recebidaBuf = Buffer.from(recebida, "base64");
      return recebidaBuf.length === esperadaBuf.length && timingSafeEqual(recebidaBuf, esperadaBuf);
    });
}

type EventoResend = {
  type: string;
  data: { email_id?: string; click?: { link?: string } };
};

export async function POST(request: NextRequest) {
  const secret = process.env.CAMPANHAS_RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ erro: "webhook não configurado" }, { status: 501 });

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return NextResponse.json({ erro: "assinatura ausente" }, { status: 400 });

  const corpoCru = await request.text();
  if (!verificarAssinatura(corpoCru, svixId, svixTimestamp, svixSignature, secret)) {
    return NextResponse.json({ erro: "assinatura inválida" }, { status: 401 });
  }

  let evento: EventoResend;
  try {
    evento = JSON.parse(corpoCru);
  } catch {
    return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });
  }

  const emailId = evento.data?.email_id;
  if (!emailId || (evento.type !== "email.opened" && evento.type !== "email.clicked")) {
    return NextResponse.json({ ok: true });
  }

  const supabase = createServiceClient();
  const agora = new Date().toISOString();

  // Só grava a PRIMEIRA ocorrência (métrica é "quantos únicos abriram/
  // clicaram", não quantas vezes) -- filtro "is null" faz isso sem round
  // trip extra pra ler antes de escrever.
  await supabase.from("campanhas_envios").update({ aberto_em: agora }).eq("resend_email_id", emailId).is("aberto_em", null);

  // O link de descadastro no rodapé não conta como "clique" pra métrica de
  // engajamento (pedido do Matheus, 15/09/2026) -- sem isso, um
  // descadastro inflava "Clicaram" junto com cliques de verdade no CTA/
  // corpo do e-mail. O Resend não oferece essa exclusão por link (checado
  // na documentação oficial), então filtra aqui pelo campo
  // data.click.link do próprio evento.
  if (evento.type === "email.clicked") {
    const linkClicado = evento.data.click?.link ?? "";
    const ehLinkDescadastro = linkClicado.includes("/campanhas/descadastro");
    if (!ehLinkDescadastro) {
      await supabase.from("campanhas_envios").update({ clicado_em: agora }).eq("resend_email_id", emailId).is("clicado_em", null);
    }
  }

  return NextResponse.json({ ok: true });
}
