import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { periodoDoMes } from "@/lib/erp/periodo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ERP O2 — fecha o mês: no dia 1, grava o retrato fixo do mês que acabou (painel de cada aba), para o mês fechado nunca mais mudar
// (mesma lógica do Workspace: mês encerrado congela, só o mês aberto recalcula). Também aquece o mês novo que começa.
// Aceita ?mes=AAAA-MM para fechar um mês específico (por ex. refazer um fechamento perdido).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const sb = createServiceClient();
    const atual = periodoDoMes();
    const alvo = periodoDoMes(request.nextUrl.searchParams.get("mes") ?? atual.anterior);
    if (!alvo.fechado) return NextResponse.json({ erro: `o mês ${alvo.mes} ainda está aberto` }, { status: 400 });
    const funcoes = FUNCOES;
    const feitos: string[] = [];
    const falhas: string[] = [];
    for (const fn of funcoes) {
      const { error } = await sb.rpc("erp_retrato", { p_funcao: fn, p_de: alvo.de, p_ate: alvo.ate, p_refazer: true });
      (error ? falhas : feitos).push(fn);
    }
    for (const fn of funcoes) await sb.rpc("erp_retrato", { p_funcao: fn, p_de: atual.de, p_ate: atual.ate, p_refazer: true });
    return NextResponse.json({ ok: falhas.length === 0, mes: alvo.mes, feitos: feitos.length, falhas });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}

const FUNCOES = [
  "erp_resumo_inicio", "erp_resumo_emissao", "erp_resumo_documentos", "erp_resumo_faturas", "erp_resumo_baixas", "erp_resumo_conferencia",
  "erp_resumo_repasses", "erp_resumo_renovacao", "erp_resumo_clientes", "erp_resumo_imobiliarias", "erp_resumo_seguradoras",
  "erp_resumo_parcelas", "erp_resumo_cobranca_imobs",
];
