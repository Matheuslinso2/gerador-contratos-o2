import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ERP O2 — baixa automática dos extratos das seguradoras×empresas com a baixa LIGADA (erp_baixa_automatica_config).
// Roda depois da leitura dos extratos (erp-extratos-drive, :40). Só baixa linhas exatas; o resto fica para tratar à mão em /erp/baixas/gestao.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const { data, error } = await createServiceClient().rpc("erp_baixa_automatica_rodar", { p_limite: 60 });
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as { r_seguradora: string; r_resultado: string }[];
    const naoAplicadas = linhas.filter((l) => l.r_resultado.startsWith("não aplicada"));
    console.log("erp-baixa-automatica", JSON.stringify({ extratos: linhas.length, naoAplicadas: naoAplicadas.length }));
    return NextResponse.json({ ok: true, extratos: linhas.length, naoAplicadas: naoAplicadas.length });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
