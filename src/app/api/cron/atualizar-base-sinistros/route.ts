import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Refaz a base mensal do dashboard de Sinistros (atualizar_base_kpis_sinistros,
// ~25 s) toda madrugada -- a carteira muda com a importação da produção do
// Corp, e o mês corrente precisa avançar mesmo sem ninguém clicar em
// "Atualizar base". Protegida por CRON_SECRET (mesmo esquema dos outros crons).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const inicio = Date.now();
  const { data, error } = await createServiceClient().rpc("atualizar_base_kpis_sinistros");
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, atualizado_em: data, ms: Date.now() - inicio });
}
