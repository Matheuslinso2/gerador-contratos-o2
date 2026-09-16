import { NextRequest, NextResponse } from "next/server";
import { renovarTokenInstagramSeNecessario } from "@/lib/instagram";
import { alertarAdmin } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Renova o token de longa duração do Instagram (60 dias) antes que expire --
// diferente do token do app do Bitrix, não tem nenhum evento natural que
// reemita esse token sozinho, então precisa desse cron rodando todo dia.
// Se a renovação falhar (token já expirado de verdade, sem jeito de
// recuperar sem passar pelo login de novo), avisa o Matheus por e-mail --
// sem isso, a publicação simplesmente pararia de funcionar silenciosamente
// na próxima tentativa.
//
// Protegida por CRON_SECRET — mesmo padrão de congelar-paineis/route.ts.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const resultado = await renovarTokenInstagramSeNecessario();

  if (resultado.acao === "falhou") {
    await alertarAdmin({
      contexto: "A renovação automática do token do Instagram falhou. A publicação de posts vai parar de funcionar até reconectar em /social-media.",
      detalhe: resultado.erro,
      quem: "Instagram (Social Media)",
    });
    return NextResponse.json({ ok: false, resultado }, { status: 500 });
  }

  return NextResponse.json({ ok: true, resultado });
}
