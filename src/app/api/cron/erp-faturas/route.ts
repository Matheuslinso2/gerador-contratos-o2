import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { carregarItensFaturas } from "@/lib/erp/faturasItens";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ERP O2 — fase B das faturas: de hora em hora lê os arquivos Tokio/Porto do /faturas (mês atual e anterior) e grava
// faturas, meses e linhas no ERP (uma fatura por imobiliária + seguradora + fatura na seguradora).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const desde = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 7);
    return NextResponse.json({ ok: true, desde, ...(await carregarItensFaturas(createServiceClient(), { desde })) });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
