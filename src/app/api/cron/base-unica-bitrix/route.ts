import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { gravarBitrixFianca, lerBitrixFianca } from "@/lib/baseUnica/bitrixFianca";
import { gravarBitrixProduto, lerBitrixProduto, type ProdutoBitrix } from "@/lib/baseUnica/bitrixProdutos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Base Única: traz as cotações do Bitrix para a linha do tempo única
// (producao_unificada) e remonta o resumo do painel /producao. Um produto por
// chamada (?produto=fianca|capitalizacao|automovel|re; sem o parâmetro =
// fianca), cada um com a mesma leitura do painel do produto. Ver
// lib/baseUnica/bitrixFianca.ts e lib/baseUnica/bitrixProdutos.ts.
//
// Protegida por CRON_SECRET — mesmo padrão de base-unica-emails/route.ts.
const OUTROS: ProdutoBitrix[] = ["capitalizacao", "automovel", "re"];

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const produto = request.nextUrl.searchParams.get("produto") ?? "fianca";
  const sb = createServiceClient();
  if (produto === "fianca") {
    const resultado = await gravarBitrixFianca(sb, await lerBitrixFianca());
    return NextResponse.json({ ok: true, produto, ...resultado });
  }
  if (!OUTROS.includes(produto as ProdutoBitrix)) return NextResponse.json({ erro: "produto inválido" }, { status: 400 });
  const resultado = await gravarBitrixProduto(sb, produto as ProdutoBitrix, await lerBitrixProduto(produto as ProdutoBitrix));
  return NextResponse.json({ ok: true, produto, ...resultado });
}
