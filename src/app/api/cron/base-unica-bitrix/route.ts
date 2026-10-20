import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { gravarBitrixFianca, lerBitrixFianca } from "@/lib/baseUnica/bitrixFianca";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Base Única — Fase 4: traz as cotações de Seguro Fiança do Bitrix para a
// linha do tempo única (producao_unificada) e remonta o resumo do painel
// /producao. Mesma leitura do painel /seguro-fianca. Ver lib/baseUnica/bitrixFianca.ts.
//
// Protegida por CRON_SECRET — mesmo padrão de base-unica-emails/route.ts.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const dados = await lerBitrixFianca();
  const resultado = await gravarBitrixFianca(createServiceClient(), dados);
  return NextResponse.json({ ok: true, ...resultado });
}
