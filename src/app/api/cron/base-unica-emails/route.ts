import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processarDia, proximoDiaPendente } from "@/lib/baseUnica/emails";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Base Única de Imobiliárias — fonte `email`. A cada execução lê UM dia
// fechado ainda não lido dentro dos últimos 30 dias (só cabeçalhos De/Para/Cc)
// e grava os endereços em `imobiliaria_registros_fonte`. Depois que os 30
// dias estão lidos, cada execução só pega o dia de ontem. Ver lib/baseUnica/emails.ts.
//
// Protegida por CRON_SECRET — mesmo padrão de relatorio-whatsapp/route.ts.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const dia = await proximoDiaPendente(supabase);
  if (!dia) return NextResponse.json({ ok: true, pulado: "últimos 30 dias já lidos" });

  // Margem de ~15s sobre o maxDuration para gravar o resultado.
  const resultado = await processarDia(supabase, dia, 42_000);
  return NextResponse.json({ ok: true, ...resultado });
}
