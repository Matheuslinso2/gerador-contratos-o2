import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { carregarItensFaturas } from "@/lib/erp/faturasItens";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ERP O2 — fase B das faturas: de hora em hora lê os arquivos Tokio/Porto do /faturas (mês atual e anterior) e grava
// faturas, meses e linhas no ERP (uma fatura por imobiliária + seguradora + fatura na seguradora).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const desde = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 7);
    const sb = createServiceClient();
    const faturas = await carregarItensFaturas(sb, { desde });
    // conferência dos vencimentos das parcelas (Corp × cobrado pela seguradora) — etapa Parcelas
    const { data: vencimentos } = await sb.rpc("erp_atualizar_vencimentos");
    // partes da apólice do acervo (segurado = proprietário, garantido = inquilino) já ligadas ao documento, para os filtros e a ficha
    const { data: partesAcervo } = await sb.rpc("erp_atualizar_partes_acervo");
    // fila de Emissão (propostas pendentes) e KPIs dos últimos 6 meses — tabelas prontas da etapa Emissão
    const { data: emissao } = await sb.rpc("erp_atualizar_emissao");
    // KPIs do mês de cada etapa (tela Início)
    const { data: inicio } = await sb.rpc("erp_atualizar_inicio");
    // contagens da tela Clientes (total e cadastros incompletos)
    const { data: clientes } = await sb.rpc("erp_atualizar_clientes_resumo");
    // resumo por imobiliária (produção vigente, propostas pendentes, faturas) — depende da fila de Emissão acima
    const { data: imobiliarias } = await sb.rpc("erp_atualizar_imobiliarias_resumo");
    return NextResponse.json({ ok: true, desde, ...faturas, vencimentos, partesAcervo, emissao, inicio, clientes, imobiliarias });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
