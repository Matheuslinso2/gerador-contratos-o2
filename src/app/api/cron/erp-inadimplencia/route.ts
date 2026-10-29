import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { carregarInadimplenciaSeguradoras } from "@/lib/erp/inadimplenciaSeguradoras";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ERP O2 — inadimplência avisada pelas seguradoras (e-mails Allianz, Pottencial, Alfa, Too) → erp_parcelas_inadimplencia, ligada às parcelas.
// Lê os e-mails dos últimos 4 dias (?desde=AAAA-MM-DD para outro período); parcelas já gravadas não duplicam.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const desdeParam = request.nextUrl.searchParams.get("desde");
  const desde = desdeParam && /^\d{4}-\d{2}-\d{2}$/.test(desdeParam) ? desdeParam : new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  try {
    const resumo = await carregarInadimplenciaSeguradoras(createServiceClient(), { desde, gravar: true });
    console.log("erp-inadimplencia", JSON.stringify(resumo));
    const ok = resumo.every((r) => r.erros.length === 0);
    return NextResponse.json({ ok, resumo }, { status: ok ? 200 : 207 });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
