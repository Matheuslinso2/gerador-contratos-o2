import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sincronizarLotesRe } from "@/lib/baseUnica/lotesRe";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Itens dos lotes de RE (planilhas anexadas aos cards da SPA 1046): arquivo novo no card entra em producao_itens + bucket lotes-re em até 1 hora.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const resumo = await sincronizarLotesRe(createServiceClient());
    return NextResponse.json({ ok: true, ...resumo });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
