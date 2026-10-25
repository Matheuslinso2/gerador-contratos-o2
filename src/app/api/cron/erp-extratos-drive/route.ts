import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { carregarExtratosDrive } from "@/lib/erp/extratosDrive";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ERP O2 — Fase 2: lê os extratos de comissão que a equipe coloca na pasta do Drive
// "BAIXA DE COMISSÃO / EXTRATOS DE COMISSÃO (o ERP lê daqui)" (de hora em hora, até 15 arquivos novos
// por rodada — PDF passa pela IA) e casa as linhas com apólices e parcelas (erp_cruzar_extratos).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const sb = createServiceClient();
  try {
    const resumo = await carregarExtratosDrive(sb, { gravar: true, max: 15 });
    const { data, error } = resumo.novos ? await sb.rpc("erp_cruzar_extratos") : { data: null, error: null };
    return NextResponse.json({ ok: true, ...resumo, cruzamento: error ? { erro: error.message } : data });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
