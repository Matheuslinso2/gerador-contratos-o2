import { NextRequest, NextResponse } from "next/server";
import { usuarioDoTokenBitrix } from "@/lib/bitrix/emailNoCard";
import { ENTIDADES_COMERCIAL, atualizarModelo, criarModelo, excluirModelo } from "@/lib/bitrix/modelosEmailBanco";

export const dynamic = "force-dynamic";

// Salvar, atualizar e excluir modelos de e-mail da área comercial (Leads e
// Negócios), chamado de dentro da aba "E-mail" do card. Roda no iframe do
// Bitrix, sem sessão do Workspace: por isso exige um token válido do Bitrix e
// registra quem fez. Excluir só desativa (o histórico fica).
export async function POST(request: NextRequest) {
  let corpo: Record<string, unknown>;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Pedido inválido." }, { status: 400 });
  }
  const authId = typeof corpo.authId === "string" ? corpo.authId : "";
  const por = authId ? await usuarioDoTokenBitrix(authId) : null;
  if (!por) return NextResponse.json({ ok: false, erro: "Sessão do Bitrix inválida. Recarregue a aba." }, { status: 401 });

  const acao = String(corpo.acao ?? "");
  const texto = (v: unknown) => (typeof v === "string" ? v : "");

  if (acao === "salvar") {
    if (!ENTIDADES_COMERCIAL.includes(Number(corpo.entityTypeId))) {
      return NextResponse.json({ ok: false, erro: "Modelos novos só podem ser criados em Leads e Negócios." }, { status: 403 });
    }
    const r = await criarModelo({ nome: texto(corpo.nome), assunto: texto(corpo.assunto), corpoHtml: texto(corpo.corpoHtml), por });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (acao === "atualizar") {
    const r = await atualizarModelo({ id: texto(corpo.id), assunto: texto(corpo.assunto), corpoHtml: texto(corpo.corpoHtml), por });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (acao === "excluir") {
    const r = await excluirModelo({ id: texto(corpo.id), por });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, erro: "Ação desconhecida." }, { status: 400 });
}
