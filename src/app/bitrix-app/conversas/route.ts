import { NextRequest, NextResponse } from "next/server";
import { tokenBitrixValido } from "@/lib/bitrix/emailNoCard";
import { listarConversas } from "@/lib/bitrix/conversasEmail";

export const dynamic = "force-dynamic";

// Conversas de e-mail já existentes neste card, pra tela de compor oferecer
// "continuar a conversa" em vez de abrir outra. Mesma proteção das demais
// rotas do /bitrix-app: só responde com um token válido do Bitrix.
export async function POST(request: NextRequest) {
  let body: { authId?: string; entityTypeId?: number; itemId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo da requisição inválido." }, { status: 400 });
  }
  const { authId, entityTypeId, itemId } = body;
  if (!authId || !(await tokenBitrixValido(authId))) {
    return NextResponse.json({ ok: false, erro: "Sessão do Bitrix inválida." }, { status: 401 });
  }
  if (!entityTypeId || !itemId) return NextResponse.json({ ok: false, erro: "Dados incompletos." }, { status: 400 });
  return NextResponse.json({ ok: true, conversas: await listarConversas(entityTypeId, itemId) });
}
