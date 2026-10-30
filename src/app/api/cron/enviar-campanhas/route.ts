import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processarLote } from "@/lib/campanhas/processarLote";
import { dispararCampanha } from "@/lib/campanhas/dispararCampanha";
import { criarCardsDaCampanha } from "@/lib/campanhas/cardsBitrix";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rede de segurança do envio de campanhas (ver vercel.json) -- o caminho
// principal é o polling autenticado da tela de progresso
// (src/app/api/campanhas/[id]/processar-lote/route.ts), que avança rápido
// enquanto o admin acompanha; este cron retoma campanhas presas em
// "enviando" com linhas ainda pendentes caso a aba tenha sido fechada antes
// da fila esvaziar. Uma campanha falhando não trava as outras (mesmo
// princípio de congelar-paineis/route.ts).
//
// Também é o único lugar que dispara agendamentos vencidos (item 9 da
// reunião de 15/09/2026) -- roda a cada 5 min (ver vercel.json), então o
// agendamento tem essa margem de precisão. Depois de virar "enviando",
// processa logo o primeiro lote no mesmo ciclo, em vez de esperar a
// próxima passada do cron só pra começar.
//
// Protegida por CRON_SECRET — a Vercel manda esse valor no header
// Authorization automaticamente para crons configurados no próprio
// vercel.json; fora disso (teste manual) precisa passar
// `Authorization: Bearer <CRON_SECRET>` à mão.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: agendadasVencidas } = await supabase
    .from("campanhas")
    .select("id")
    .eq("status", "agendada")
    .lte("agendado_para", new Date().toISOString());

  const resultadosAgendamento = await Promise.all(
    (agendadasVencidas ?? []).map(async (c) => {
      const resultado = await dispararCampanha(supabase, c.id);
      return { campanhaId: c.id, ...resultado };
    })
  );

  const { data: campanhas } = await supabase.from("campanhas").select("id").eq("status", "enviando");

  const resultados = await Promise.all(
    (campanhas ?? []).map(async (c) => {
      try {
        const resultado = await processarLote(c.id);
        return { campanhaId: c.id, ok: true, ...resultado };
      } catch (erro) {
        return { campanhaId: c.id, ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
      }
    })
  );

  // Cards no funil Campanhas do Bitrix (30/10/2026): só para campanha com o
  // interruptor ligado, e só depois de os e-mails iniciais terem saído
  // (enviando/concluída). Em lotes pequenos; a próxima passada continua. Uma
  // falha aqui nunca derruba o envio.
  const cardsCriados: unknown[] = [];
  try {
    const { data: comCards } = await supabase
      .from("campanhas")
      .select("id, nome, valido_de, valido_ate, imobiliarias_selecionadas, criado_por_email, disparada_em")
      .eq("criar_cards_bitrix", true)
      .is("campanha_pai_id", null)
      .in("status", ["enviando", "concluida"])
      .gte("disparada_em", new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());
    for (const c of comCards ?? []) {
      try {
        cardsCriados.push({ campanhaId: c.id, ...(await criarCardsDaCampanha(supabase, c, "cron:campanha", 15)) });
      } catch (e) {
        cardsCriados.push({ campanhaId: c.id, erro: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    cardsCriados.push({ erro: e instanceof Error ? e.message : String(e) });
  }

  const ok = resultados.every((r) => r.ok) && resultadosAgendamento.every((r) => r.ok);
  return NextResponse.json(
    { ok, agendamentosDisparados: resultadosAgendamento, processadas: resultados.length, resultados, cardsCriados },
    { status: ok ? 200 : 500 }
  );
}
