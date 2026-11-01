import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { periodoDoMes } from "@/lib/erp/periodo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ERP O2 — refaz a tabela pronta da cobrança (erp_parcelas_cobranca_pronta) a cada 10 minutos, para a tela Cobrança e inadimplência abrir na hora.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const sb = createServiceClient();
    const { data, error } = await sb.rpc("erp_cobranca_atualizar");
    if (error) throw new Error(error.message);
    const mes = periodoDoMes(null); // mês corrente (período padrão do ERP)
    // aquece o cache dos painéis que leem a tabela pronta
    for (const fn of ["erp_resumo_parcelas", "erp_resumo_cobranca_imobs"]) await sb.rpc("erp_retrato", { p_funcao: fn, p_de: mes.de, p_ate: mes.ate, p_refazer: true });
    return NextResponse.json({ ok: true, parcelas: data });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
