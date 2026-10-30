import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ERP O2 — refaz o retrato da tela de Repasses (erp_repasse_resumo_pronto) dos meses abertos, depois da baixa automática (:55).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const { data, error } = await createServiceClient().rpc("erp_atualizar_repasse_resumo_abertos");
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, meses: data });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
