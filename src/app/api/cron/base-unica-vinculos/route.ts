import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { vincularAutomaticamente } from "@/lib/baseUnica/vinculosAutomaticos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Base Única — liga sozinho os nomes novos das fontes (empresas do Bitrix,
// nomes das planilhas, produtores do Corp) às fichas de imobiliária, de hora
// em hora, depois da leitura do Bitrix (:40). Regras em
// lib/baseUnica/vinculosAutomaticos.ts (pedido do Matheus, 21/10/2026).
//
// Protegida por CRON_SECRET — mesmo padrão de base-unica-bitrix/route.ts.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const r = await vincularAutomaticamente(createServiceClient(), { gravar: true });
  return NextResponse.json({
    ok: true,
    mudancas: r.mudancas,
    porTipo: r.porTipo,
    confirmadosPorNome: r.confirmadosPorNome.length,
    revisarGruposDiferentes: r.revisarGruposDiferentes,
    revisarParecido: r.revisarParecido,
  });
}
