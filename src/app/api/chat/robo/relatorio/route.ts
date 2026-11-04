import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatVisivelPara } from "@/lib/chat/acesso";
import { roboLiberadoPara } from "@/lib/chat/niveisAcesso";
import { gerarPdfDaResposta } from "@/lib/chat/relatorioResposta";
import { textoTemDadosPessoais } from "@/lib/chat/privacidadePdf";
import { contextoPainelValido } from "@/lib/chat/paineis";
import { registrarProtocolo } from "@/lib/chat/protocolo";

export const maxDuration = 30;

// Botão "Gerar relatório em PDF" embaixo de cada resposta do Robô O2. Mesmo gate do chat.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !chatVisivelPara(user.email) || !roboLiberadoPara(user.email)) return NextResponse.json({ erro: "sem acesso" }, { status: 403 });

  const corpo = (await req.json().catch(() => null)) as {
    pergunta?: string;
    resposta?: string;
    logica?: string | null;
    fontes?: string[];
    painel?: unknown;
    conversa?: { role: "user" | "assistant"; content: string }[];
  } | null;
  if (!corpo?.resposta || typeof corpo.resposta !== "string") return NextResponse.json({ erro: "resposta vazia" }, { status: 400 });
  // Trava de privacidade: documento, e-mail ou telefone no texto = dado pessoal, sem PDF (a regra completa vale no robô).
  if (textoTemDadosPessoais(corpo.resposta) || textoTemDadosPessoais(String(corpo.pergunta ?? ""))) {
    return NextResponse.json({ erro: "Respostas com dados pessoais não geram PDF." }, { status: 422 });
  }

  try {
    // Relatório gerado dentro de um painel: nasce com protocolo e o caminho fica guardado (04/11/2026).
    const painel = corpo.painel ? contextoPainelValido(corpo.painel) : null;
    let protocolo: string | null = null;
    if (painel) {
      const conversa = (corpo.conversa ?? []).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string").slice(-12);
      protocolo = await registrarProtocolo({
        email: user.email,
        tipo: "pdf",
        painelId: painel.id,
        competencia: painel.competencia,
        pergunta: String(corpo.pergunta ?? ""),
        conversa: conversa.length ? conversa : [{ role: "user", content: String(corpo.pergunta ?? "") }],
        logica: typeof corpo.logica === "string" ? corpo.logica : null,
        fontes: Array.isArray(corpo.fontes) ? corpo.fontes.map((f) => String(f).slice(0, 200)).slice(0, 8) : [],
        cardsSelecionados: [],
        todosOsCards: false,
        totalCardsDaResposta: 0,
      }).catch((e) => {
        console.error("[chat/robo/relatorio] protocolo", e);
        return null;
      });
    }
    const r = await gerarPdfDaResposta({
      protocolo,
      pergunta: String(corpo.pergunta ?? ""),
      resposta: corpo.resposta,
      email: user.email,
      logica: typeof corpo.logica === "string" ? corpo.logica.slice(0, 700) : null,
      fontes: Array.isArray(corpo.fontes) ? corpo.fontes.map((f) => String(f).slice(0, 200)).slice(0, 8) : [],
    });
    if ("erro" in r) return NextResponse.json({ erro: r.erro }, { status: 500 });
    return NextResponse.json({ url: r.url, protocolo });
  } catch (e) {
    console.error("[chat/robo/relatorio]", e);
    return NextResponse.json({ erro: "falha" }, { status: 500 });
  }
}
