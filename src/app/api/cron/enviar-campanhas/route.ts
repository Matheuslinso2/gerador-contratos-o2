import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processarLote } from "@/lib/campanhas/processarLote";

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

  const ok = resultados.every((r) => r.ok);
  return NextResponse.json({ ok, processadas: resultados.length, resultados }, { status: ok ? 200 : 500 });
}
