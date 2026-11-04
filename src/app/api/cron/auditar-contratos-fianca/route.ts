import { NextRequest, NextResponse } from "next/server";
import { buscarItem } from "@/lib/bitrix/client";
import { auditarCardFianca, ENTITY_TYPE_FIANCA } from "@/lib/bitrix/auditoriaContratoCard";
import { createClient } from "@/lib/supabase/server";
import { isEquipe } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Auditoria automática do contrato nos cards do Seguro Fiança (04/11/2026) -- MODO TESTE: devolve o parecer em JSON para os
// cards informados (?cards=3550,3128) e NÃO escreve nada no Bitrix. O gatilho por etapa (Contrato Recebido + 30 min) e o
// comentário no card só entram depois do OK do Matheus. Protegida por CRON_SECRET.
export async function GET(request: NextRequest) {
  // Autorização: CRON_SECRET (cron) OU login da equipe O2 (teste manual feito logado).
  const segredo = process.env.CRON_SECRET;
  const porSegredo = !!segredo && request.headers.get("authorization") === `Bearer ${segredo}`;
  if (!porSegredo) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!isEquipe(user?.email)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const ids = (request.nextUrl.searchParams.get("cards") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0).slice(0, 3);
  if (!ids.length) return NextResponse.json({ erro: "informe ?cards=ID,ID (máx. 3 por chamada)" }, { status: 400 });

  // ?salvar=1: cada parecer é gravado em auditoria_contrato_card (modo teste) -- o resultado não depende de quem chamou esperar a resposta.
  const salvar = request.nextUrl.searchParams.get("salvar") === "1";
  const gravar = async (linha: Record<string, unknown>) => {
    if (salvar) await createServiceClient().from("auditoria_contrato_card").insert({ entity_type_id: ENTITY_TYPE_FIANCA, modo: "teste", ...linha });
  };
  const resultados = [];
  for (const id of ids) {
    const t0 = Date.now();
    try {
      const item = await buscarItem(ENTITY_TYPE_FIANCA, id);
      const rua = String(item.ufCrm10_1776351662 ?? "").trim();
      const num = String(item.ufCrm10_1776351686 ?? "").trim();
      const r = await auditarCardFianca({ id, titulo: String(item.title), endereco: rua ? `${rua} ${num}`.trim() : null });
      const segundos = Math.round((Date.now() - t0) / 1000);
      resultados.push(
        r.ok
          ? { id, titulo: item.title, status: r.relatorio.status_geral, arquivos: r.arquivos, avisos: r.avisos, parecer: r.parecer, segundos }
          : { id, titulo: item.title, semContrato: r.motivo }
      );
      await gravar(r.ok
        ? { item_id: id, titulo: String(item.title), status: r.relatorio.status_geral, parecer: r.parecer, relatorio: r.relatorio, arquivos: r.arquivos, avisos: r.avisos, segundos }
        : { item_id: id, titulo: String(item.title), status: "SEM_CONTRATO", avisos: [r.motivo], segundos });
    } catch (e) {
      resultados.push({ id, erro: (e as Error).message });
      await gravar({ item_id: id, status: "ERRO", avisos: [(e as Error).message] });
    }
  }
  return NextResponse.json({ modo: "teste (nada foi escrito no Bitrix)", resultados });
}
