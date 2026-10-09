import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { atualizarMetricasPosts } from "@/lib/social/metricas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Atualiza as métricas (curtidas, alcance, visualizações...) dos posts
// publicados pro dashboard de /social-media/dashboard. Protegida por
// CRON_SECRET -- mesmo padrão de renovar-token-instagram/route.ts.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const resultado = await atualizarMetricasPosts(createServiceClient());
  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 500 });
}
