import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CONFIGS, sincronizarSpa } from "@/lib/erp/bitrixOrigem";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ERP O2 — T2: cards do Bitrix → documentos do ERP, de hora em hora, um funil por chamada
// (?spa=1042|1046|1048|1050). Só cards novos ou alterados desde a última captura, com até
// 25 cards de comentários por rodada (limite de tempo da Vercel e de chamadas do Bitrix).
// Protegida por CRON_SECRET — mesmo padrão de base-unica-bitrix/route.ts.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const spa = Number(request.nextUrl.searchParams.get("spa") ?? 1042);
  const cfg = CONFIGS.find((c) => c.entityTypeId === spa);
  if (!cfg) return NextResponse.json({ erro: "spa inválida" }, { status: 400 });
  const resumo = await sincronizarSpa(createServiceClient(), cfg, { desde: "2026-07-01", gravar: true, comentarios: 25, apenasAlterados: true });
  return NextResponse.json({ ok: resumo.erros.length === 0, ...resumo });
}
