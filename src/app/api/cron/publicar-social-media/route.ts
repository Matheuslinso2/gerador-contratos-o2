import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { publicarPostPorId } from "@/lib/social/publicar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dispara publicações agendadas com a hora vencida (ver "Agendar
// publicação" em src/app/social-media/page.tsx) -- roda a cada 5 min (ver
// vercel.json), mesmo padrão e mesma margem de precisão do cron de
// campanhas (src/app/api/cron/enviar-campanhas/route.ts). Publicar não
// depende de sessão de admin aqui porque já foi aprovado no momento do
// agendamento; o resultado (sucesso ou erro) fica gravado no próprio post,
// igual ao clique manual em "Aprovar e publicar".
//
// Protegida por CRON_SECRET — mesmo padrão dos outros crons.
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

  const { data: agendadosVencidos } = await supabase
    .from("social_media_posts")
    .select("id")
    .eq("status", "agendado")
    .lte("agendado_para", new Date().toISOString());

  const resultados = await Promise.all(
    (agendadosVencidos ?? []).map(async (p) => {
      const resultado = await publicarPostPorId(supabase, p.id);
      return { postId: p.id, ...resultado };
    })
  );

  const ok = resultados.every((r) => r.ok);
  return NextResponse.json({ ok, publicados: resultados.length, resultados }, { status: ok ? 200 : 500 });
}
