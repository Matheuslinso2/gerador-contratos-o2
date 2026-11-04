import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatVisivelPara } from "@/lib/chat/acesso";
import { roboLiberadoPara } from "@/lib/chat/niveisAcesso";
import { responderComoRobo, type TurnoChat } from "@/lib/chat/robo";

export const maxDuration = 120;

const MAX_TURNOS = 10;
const MAX_CARACTERES = 2000;

// Robô O2 do chat da equipe: só usuário logado com acesso ao chat (mesmo gate do balão).
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Robô O2 só para e-mail @o2seguros.com.br (níveis em lib/chat/niveisAcesso.ts); o chat entre pessoas segue com o gate do balão.
  if (!user?.email || !chatVisivelPara(user.email) || !roboLiberadoPara(user.email)) return NextResponse.json({ erro: "sem acesso" }, { status: 403 });

  const corpo = (await req.json().catch(() => null)) as { mensagens?: TurnoChat[] } | null;
  const turnos = (corpo?.mensagens ?? [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-MAX_TURNOS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_CARACTERES) }));
  // A conversa tem de começar e terminar com uma pergunta do usuário.
  while (turnos.length && turnos[0].role !== "user") turnos.shift();
  if (!turnos.length || turnos[turnos.length - 1].role !== "user") return NextResponse.json({ erro: "mensagem vazia" }, { status: 400 });

  try {
    const r = await responderComoRobo(user.email, turnos);
    return NextResponse.json({ resposta: r.texto, pdfPermitido: r.pdfPermitido, dadosPessoais: r.dadosPessoais, logica: r.logica, fontes: r.fontes });
  } catch (e) {
    console.error("[chat/robo]", e);
    return NextResponse.json({ erro: "falha" }, { status: 500 });
  }
}
