import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatVisivelPara } from "@/lib/chat/acesso";
import { roboLiberadoPara } from "@/lib/chat/niveisAcesso";
import { gerarPdfDaResposta } from "@/lib/chat/relatorioResposta";
import { textoTemDadosPessoais } from "@/lib/chat/privacidadePdf";

export const maxDuration = 30;

// Botão "Gerar relatório em PDF" embaixo de cada resposta do Robô O2. Mesmo gate do chat.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !chatVisivelPara(user.email) || !roboLiberadoPara(user.email)) return NextResponse.json({ erro: "sem acesso" }, { status: 403 });

  const corpo = (await req.json().catch(() => null)) as { pergunta?: string; resposta?: string; logica?: string | null; fontes?: string[] } | null;
  if (!corpo?.resposta || typeof corpo.resposta !== "string") return NextResponse.json({ erro: "resposta vazia" }, { status: 400 });
  // Trava de privacidade: documento, e-mail ou telefone no texto = dado pessoal, sem PDF (a regra completa vale no robô).
  if (textoTemDadosPessoais(corpo.resposta) || textoTemDadosPessoais(String(corpo.pergunta ?? ""))) {
    return NextResponse.json({ erro: "Respostas com dados pessoais não geram PDF." }, { status: 422 });
  }

  try {
    const r = await gerarPdfDaResposta({
      pergunta: String(corpo.pergunta ?? ""),
      resposta: corpo.resposta,
      email: user.email,
      logica: typeof corpo.logica === "string" ? corpo.logica.slice(0, 700) : null,
      fontes: Array.isArray(corpo.fontes) ? corpo.fontes.map((f) => String(f).slice(0, 200)).slice(0, 8) : [],
    });
    if ("erro" in r) return NextResponse.json({ erro: r.erro }, { status: 500 });
    return NextResponse.json({ url: r.url });
  } catch (e) {
    console.error("[chat/robo/relatorio]", e);
    return NextResponse.json({ erro: "falha" }, { status: 500 });
  }
}
