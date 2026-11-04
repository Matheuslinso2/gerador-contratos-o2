import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PONTE TEMPORÁRIA Corp -> base própria de sinistros (decisão do Matheus, 04/11/2026): todo sinistro que o Corp registrar (feed do Power BI/SharePoint,
// tabela corp_sinistros) e que ainda não está na base é conferido com o ERP e criado na base própria, ligado à apólice, imobiliária, imóvel e pessoas do ERP
// (função sinistros_ponte_corp). Roda de hora em hora, depois do cron corp-sharepoint. DESLIGAR (remover do vercel.json) no dia em que o Corp for desligado.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const { data, error } = await createServiceClient().rpc("sinistros_ponte_corp", { p_gravar: true });
    if (error) throw new Error(error.message);
    const r = data as Record<string, unknown>;
    // sem a lista detalhada (tem números de apólice e sinistro)
    return NextResponse.json({ ok: true, candidatos: r.candidatos, novosCards: r.novos_cards, ligados: r.ligados_ao_modulo, soArquivo: r.so_arquivo, semApoliceNoErp: r.sem_apolice_no_erp, revisarSemData: r.revisar_sem_data });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
