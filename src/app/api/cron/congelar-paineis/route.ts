import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarAnaliseGerencialAoVivo } from "@/lib/bitrix/seguroFianca";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Disparada pelo Vercel Cron (ver vercel.json) à 00h de Brasília no dia 1º
// de cada mês -- congela o snapshot do Seguro Fiança da competência que
// ACABOU DE FECHAR (mês anterior a "agora"), pra não depender de alguém
// abrir a página no último dia do mês pra "Em Andamento"/etc ficarem
// corretos daquela competência pra sempre (ver comentário no topo de
// src/lib/bitrix/seguroFianca.ts sobre por que congelamento é necessário
// além de só filtrar por data).
//
// Protegida por CRON_SECRET — a Vercel manda esse valor no header
// Authorization automaticamente para crons configurados no próprio
// vercel.json; fora disso (teste manual) precisa passar
// `Authorization: Bearer <CRON_SECRET>` à mão.
function competenciaFechada(): string {
  const agora = new Date();
  const mesAnterior = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1));
  return `${mesAnterior.getUTCFullYear()}-${String(mesAnterior.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const competencia = competenciaFechada();

  try {
    const gerencial = await buscarAnaliseGerencialAoVivo(competencia);
    const atualizadoEm = new Date().toISOString();
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("seguro_fianca_snapshots")
      .upsert({ competencia, atualizado_em: atualizadoEm, payload: gerencial }, { onConflict: "competencia" });
    if (error) {
      return NextResponse.json({ ok: false, competencia, erro: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, competencia, totalCards: gerencial.kpis.total });
  } catch (erro) {
    return NextResponse.json(
      { ok: false, competencia, erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
