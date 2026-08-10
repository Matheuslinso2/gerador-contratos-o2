import { NextRequest, NextResponse } from "next/server";
import { coletarNoticias } from "@/lib/social/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Disparada pelo Vercel Cron (ver vercel.json) uma vez por dia. Protegida
// por CRON_SECRET — a Vercel manda esse valor no header Authorization
// automaticamente para crons configurados no próprio vercel.json; fora
// disso (teste manual) precisa passar `Authorization: Bearer <CRON_SECRET>`
// à mão.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  try {
    const resultados = await coletarNoticias();
    return NextResponse.json({ ok: true, resultados });
  } catch (erro) {
    return NextResponse.json(
      { ok: false, erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
