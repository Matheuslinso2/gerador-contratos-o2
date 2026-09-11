import { NextRequest, NextResponse } from "next/server";
import { tokenBitrixValido, buscarInfoCardParaEmail } from "@/lib/bitrix/emailNoCard";

export const dynamic = "force-dynamic";

// Prévia dos dados do card mostrada na própria tela de composição --
// pedido do Matheus depois de ver a Fase 3 sem preview ("onde inclui os
// dados do card?"). Mesma checagem de sessão do Bitrix que enviar-email,
// já que também roda sem cookie da Plataforma O2: sem isso, esta rota
// viraria um jeito de qualquer um consultar título/empresa/responsável de
// qualquer card só sabendo o entityTypeId+itemId.
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

  if (!entityTypeId || !itemId) {
    return NextResponse.json({ ok: false, erro: "entityTypeId e itemId são obrigatórios." }, { status: 400 });
  }

  const info = await buscarInfoCardParaEmail(entityTypeId, itemId);
  return NextResponse.json({ ok: true, info });
}
