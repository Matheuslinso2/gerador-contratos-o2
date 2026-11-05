import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ERP O2 — baixa automática dos extratos das seguradoras×empresas com a baixa LIGADA (erp_baixa_automatica_config).
// Roda depois da leitura dos extratos (erp-extratos-drive, :18; esta rotina roda às :36 desde 05/11). Só baixa linhas exatas; o resto fica para tratar à mão em /erp/baixas/gestao.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const { data, error } = await createServiceClient().rpc("erp_baixa_automatica_rodar", { p_limite: 60 });
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as { r_seguradora: string; r_resultado: string }[];
    // renova os retratos das consultas pesadas da tela de Baixas (previsões, inadimplência, endossos) usados nos últimos 2 dias
    const { data: retratos } = await createServiceClient().rpc("erp_retrato_renovar");
    // a cada 6 horas (00, 06, 12, 18 UTC) recalcula a verificação de campos (cruzamento de todas as fontes) das apólices vigentes de Fiança;
    // outros ramos entram quando o Matheus aprovar o piloto
    let verificacao: unknown = null;
    if (new Date().getUTCHours() % 6 === 0) {
      const { data: v, error: ev } = await createServiceClient().rpc("erp_verificacao_calcular", { p_ramo: "%FIAN%", p_situacao: "vigente", p_limite: 5000 });
      verificacao = ev ? { erro: ev.message } : v;
      console.log("erp-verificacao", JSON.stringify(verificacao));
    }
    const naoAplicadas = linhas.filter((l) => l.r_resultado.startsWith("não aplicada"));
    console.log("erp-baixa-automatica", JSON.stringify({ extratos: linhas.length, naoAplicadas: naoAplicadas.length, retratos }));
    return NextResponse.json({ ok: true, extratos: linhas.length, naoAplicadas: naoAplicadas.length, retratos, ...(verificacao ? { verificacao } : {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
