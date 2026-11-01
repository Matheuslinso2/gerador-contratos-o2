import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Cubo de estatísticas do Robô O2 (chat_cubo): refeito de hora em hora, depois das cargas do Bitrix (:20 a :32) e do ERP (:55 a :58).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const { data, error } = await createServiceClient().rpc("chat_cubo_atualizar");
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, atualizadoEm: data });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
