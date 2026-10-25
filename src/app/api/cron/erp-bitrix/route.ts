import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CONFIGS, sincronizarSpa } from "@/lib/erp/bitrixOrigem";
import { carregarExtratos } from "@/lib/erp/extratos";

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
  const sb = createServiceClient();
  // cards de endosso em andamento recebem o "Código O2 da apólice" ou o pedido dele (comentário no card)
  const resumo = await sincronizarSpa(sb, cfg, { desde: "2026-07-01", gravar: true, comentarios: 25, apenasAlterados: true, escreverNoBitrix: "abertos" });
  // todo endosso é filho de uma apólice: liga os novos (dos cards e do Corp) pela seguradora + nº da apólice
  await sb.rpc("erp_vincular_endossos", { p_limite: 2000 });
  // alertas de fatura (lista pronta para a tela /erp/conferencia): refaz 1× por hora, junto da Fiança
  let alertas: unknown = null;
  if (spa === 1042) {
    // cruza as faturas carregadas no /faturas com as apólices do ERP (quem apareceu = forma de pagamento fatura)
    await sb.rpc("erp_cruzar_faturas_carregadas");
    const { data, error } = await sb.rpc("erp_atualizar_alertas_fatura");
    alertas = error ? { erro: error.message } : data;
    // administrado × não administrado deduzido pela forma de pagamento ESCOLHIDA (fatura → sim; boleto/cartão com fatura ativa → não)
    await sb.rpc("erp_inferir_administrado");
  }
  // extratos de comissão (Pottencial/Too/Tokio-resumo) do Gmail → ERP, junto da Capitalização (1× por hora)
  let extratos: unknown = null;
  if (spa === 1048) {
    try {
      const desde = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
      const carga = await carregarExtratos(sb, { desde, gravar: true, max: 20 });
      const { data, error } = await sb.rpc("erp_cruzar_extratos");
      // linhas negativas do extrato = estornos de endosso: casa com o endosso e refaz a lista pronta dos 2 alertas
      await sb.rpc("erp_atualizar_estornos_endosso");
      extratos = { carga, cruzamento: error ? { erro: error.message } : data };
    } catch (e) {
      extratos = { erro: (e as Error).message };
    }
  }
  return NextResponse.json({ ok: resumo.erros.length === 0, ...resumo, alertas, extratos });
}
