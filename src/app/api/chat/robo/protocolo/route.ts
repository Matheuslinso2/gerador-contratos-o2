import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isMatheus } from "@/lib/admin";
import { chatVisivelPara } from "@/lib/chat/acesso";
import { roboLiberadoPara } from "@/lib/chat/niveisAcesso";
import { contextoPainelValido } from "@/lib/chat/paineis";
import { REGEX_PROTOCOLO, registrarProtocolo } from "@/lib/chat/protocolo";

export const maxDuration = 20;

type Turno = { role: "user" | "assistant"; content: string };

// Registra o protocolo de uma LISTA de cards pedida no campo do Robô O2 do painel (o do PDF nasce na rota do relatório).
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !chatVisivelPara(user.email) || !roboLiberadoPara(user.email)) return NextResponse.json({ erro: "sem acesso" }, { status: 403 });

  const c = (await req.json().catch(() => null)) as {
    painel?: unknown;
    conversa?: Turno[];
    logica?: string | null;
    fontes?: string[];
    cardsSelecionados?: { id: number; produto: string }[];
    todosOsCards?: boolean;
    totalCardsDaResposta?: number;
  } | null;
  const painel = contextoPainelValido(c?.painel);
  const conversa = (c?.conversa ?? []).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string").slice(-12);
  const pergunta = [...conversa].reverse().find((t) => t.role === "user")?.content;
  if (!painel || !pergunta) return NextResponse.json({ erro: "dados incompletos" }, { status: 400 });

  try {
    const protocolo = await registrarProtocolo({
      email: user.email,
      tipo: "lista",
      painelId: painel.id,
      competencia: painel.competencia,
      pergunta,
      conversa,
      logica: typeof c?.logica === "string" ? c.logica : null,
      fontes: Array.isArray(c?.fontes) ? c!.fontes!.map((f) => String(f).slice(0, 200)) : [],
      cardsSelecionados: (c?.cardsSelecionados ?? []).filter((x) => Number.isInteger(x.id)).slice(0, 100).map((x) => ({ id: x.id, produto: String(x.produto).slice(0, 20) })),
      todosOsCards: !!c?.todosOsCards,
      totalCardsDaResposta: Number(c?.totalCardsDaResposta) || 0,
    });
    return NextResponse.json({ protocolo });
  } catch (e) {
    console.error("[chat/robo/protocolo]", e);
    return NextResponse.json({ erro: "falha" }, { status: 500 });
  }
}

// Consulta de um protocolo para refazer a pesquisa: por enquanto só o Matheus (pedido de 04/11/2026).
// Com ?lista=1&painel=ID devolve a LISTA dos protocolos da própria pessoa naquele painel (05/11/2026): só código, pergunta, mês e hora.
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const url = new URL(req.url);
  if (url.searchParams.get("lista") === "1") {
    if (!user?.email || !chatVisivelPara(user.email) || !roboLiberadoPara(user.email)) return NextResponse.json({ erro: "sem acesso" }, { status: 403 });
    const painelId = url.searchParams.get("painel") ?? "";
    if (painelId && !contextoPainelValido({ id: painelId, competencia: "2000-01" })) return NextResponse.json({ erro: "painel inválido" }, { status: 400 });
    let q = createServiceClient()
      .from("robo_protocolos")
      .select("protocolo, pergunta, competencia, tipo, criado_em")
      .eq("email", user.email.toLowerCase());
    // sem painel = histórico do chat geral
    q = painelId ? q.eq("painel_id", painelId) : q.is("painel_id", null);
    const { data } = await q.order("criado_em", { ascending: false }).limit(40);
    return NextResponse.json({ itens: data ?? [] });
  }
  if (!isMatheus(user?.email)) return NextResponse.json({ erro: "sem acesso" }, { status: 403 });
  const codigo = new URL(req.url).searchParams.get("codigo")?.trim().toUpperCase() ?? "";
  if (!REGEX_PROTOCOLO.test(codigo)) return NextResponse.json({ erro: "Protocolo inválido. O formato é RO2-AAAAMMDD-XXXXXX." }, { status: 400 });
  const { data } = await createServiceClient()
    .from("robo_protocolos")
    .select("protocolo, email, painel_id, competencia, tipo, pergunta, caminho, logica, fontes, cards_selecionados, criado_em")
    .eq("protocolo", codigo)
    .maybeSingle();
  if (!data) return NextResponse.json({ erro: "Protocolo não encontrado." }, { status: 404 });
  return NextResponse.json(data);
}
