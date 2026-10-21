import { NextRequest, NextResponse } from "next/server";
import { tokenBitrixValido } from "@/lib/bitrix/emailNoCard";
import { buscarConversasGmail, lerTratativaDoCard, vincularConversaGmail } from "@/lib/bitrix/conversasGmail";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Aba E-mail do card: procura no Gmail as conversas com o destinatário
// (acao "buscar") e vincula a escolhida ao card (acao "vincular"). Mesma
// proteção das demais rotas do /bitrix-app: só com token válido do Bitrix.
export async function POST(request: NextRequest) {
  let body: { authId?: string; acao?: string; entityTypeId?: number; itemId?: number; enderecos?: string[]; threadId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo da requisição inválido." }, { status: 400 });
  }
  const { authId, acao, entityTypeId, itemId } = body;
  if (!authId || !(await tokenBitrixValido(authId))) {
    return NextResponse.json({ ok: false, erro: "Sessão do Bitrix inválida." }, { status: 401 });
  }
  if (!entityTypeId || !itemId) return NextResponse.json({ ok: false, erro: "Dados incompletos." }, { status: 400 });

  try {
    if (acao === "vincular") {
      if (!body.threadId) return NextResponse.json({ ok: false, erro: "Escolha uma conversa." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await vincularConversaGmail(entityTypeId, itemId, body.threadId)) });
    }
    const tratativa = await lerTratativaDoCard(entityTypeId, itemId);
    return NextResponse.json({ ok: true, conversas: await buscarConversasGmail(Array.isArray(body.enderecos) ? body.enderecos : [], tratativa) });
  } catch (erro) {
    console.error("Falha na conversa do Gmail:", erro);
    return NextResponse.json({ ok: false, erro: `Não consegui consultar o Gmail: ${(erro as Error).message}` }, { status: 502 });
  }
}
