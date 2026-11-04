import { NextRequest, NextResponse } from "next/server";
import { buscarItem } from "@/lib/bitrix/client";
import { auditarCardFianca, ENTITY_TYPE_FIANCA } from "@/lib/bitrix/auditoriaContratoCard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Auditoria automática do contrato nos cards do Seguro Fiança (04/11/2026) -- MODO TESTE: devolve o parecer em JSON para os
// cards informados (?cards=3550,3128) e NÃO escreve nada no Bitrix. O gatilho por etapa (Contrato Recebido + 30 min) e o
// comentário no card só entram depois do OK do Matheus. Protegida por CRON_SECRET.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });

  const ids = (request.nextUrl.searchParams.get("cards") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0).slice(0, 3);
  if (!ids.length) return NextResponse.json({ erro: "informe ?cards=ID,ID (máx. 3 por chamada)" }, { status: 400 });

  const resultados = [];
  for (const id of ids) {
    const t0 = Date.now();
    try {
      const item = await buscarItem(ENTITY_TYPE_FIANCA, id);
      const rua = String(item.ufCrm10_1776351662 ?? "").trim();
      const num = String(item.ufCrm10_1776351686 ?? "").trim();
      const r = await auditarCardFianca({ id, titulo: String(item.title), endereco: rua ? `${rua} ${num}`.trim() : null });
      resultados.push(
        r.ok
          ? { id, titulo: item.title, status: r.relatorio.status_geral, arquivos: r.arquivos, avisos: r.avisos, parecer: r.parecer, segundos: Math.round((Date.now() - t0) / 1000) }
          : { id, titulo: item.title, semContrato: r.motivo }
      );
    } catch (e) {
      resultados.push({ id, erro: (e as Error).message });
    }
  }
  return NextResponse.json({ modo: "teste (nada foi escrito no Bitrix)", resultados });
}
