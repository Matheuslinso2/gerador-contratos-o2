import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatVisivelPara } from "@/lib/chat/acesso";
import { gerarPdfDaResposta } from "@/lib/chat/relatorioResposta";

export const maxDuration = 30;

// Botão "Gerar relatório em PDF" embaixo de cada resposta do Robô O2. Mesmo gate do chat.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !chatVisivelPara(user.email)) return NextResponse.json({ erro: "sem acesso" }, { status: 403 });

  const corpo = (await req.json().catch(() => null)) as { pergunta?: string; resposta?: string } | null;
  if (!corpo?.resposta || typeof corpo.resposta !== "string") return NextResponse.json({ erro: "resposta vazia" }, { status: 400 });

  try {
    const r = await gerarPdfDaResposta({ pergunta: String(corpo.pergunta ?? ""), resposta: corpo.resposta, email: user.email });
    if ("erro" in r) return NextResponse.json({ erro: r.erro }, { status: 500 });
    return NextResponse.json({ url: r.url });
  } catch (e) {
    console.error("[chat/robo/relatorio]", e);
    return NextResponse.json({ erro: "falha" }, { status: 500 });
  }
}
