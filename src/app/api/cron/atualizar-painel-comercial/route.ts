import { NextRequest, NextResponse } from "next/server";
import { atualizarRetrato } from "@/lib/painelComercial/retrato";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mantém o retrato do Painel Comercial v5 fresco (mesma cadência dos outros
// painéis). Protegida por CRON_SECRET. Só lê o Bitrix.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const r = await atualizarRetrato();
    return NextResponse.json({ ok: true, geradoEm: r.geradoEm, datasets: Object.fromEntries(Object.entries(r.dados).map(([k, v]) => [k, v.length])) });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "falha ao atualizar" }, { status: 500 });
  }
}
