import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Remonta as tabelas prontas da análise de preços (ficha de visita da
// Imobiliária 360): margem por apólice (analise_margem, a partir do ERP) e
// aluguel por região / preço por seguradora / perfil por imobiliária
// (analise_*) e séries de mercado da aba "Dados estatísticos O2" do Início (analise_mercado_*). Rodar 1x por dia basta: são retratos de 24 meses.
// Ver supabase/schema_analise_margem*.sql e schema_ficha_visita.sql.
//
// Protegida por CRON_SECRET — mesmo padrão de base-unica-bitrix/route.ts.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const sb = createServiceClient();
  const margem = await sb.rpc("atualizar_analise_margem");
  if (margem.error) return NextResponse.json({ erro: "margem: " + margem.error.message }, { status: 500 });
  const visita = await sb.rpc("atualizar_analise_visita");
  if (visita.error) return NextResponse.json({ erro: "visita: " + visita.error.message }, { status: 500 });
  const mercado = await sb.rpc("atualizar_analise_mercado");
  if (mercado.error) return NextResponse.json({ erro: "mercado: " + mercado.error.message }, { status: 500 });
  const faixa = await sb.rpc("atualizar_analise_mercado_faixa");
  if (faixa.error) return NextResponse.json({ erro: "faixa: " + faixa.error.message }, { status: 500 });
  const produtos = await sb.rpc("atualizar_analise_produtos");
  if (produtos.error) return NextResponse.json({ erro: "produtos: " + produtos.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, linhas_produtos: produtos.data, linhas_faixa: faixa.data, linhas_margem: margem.data, entidades_visita: visita.data, meses_mercado: mercado.data });
}
