import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMatheus } from "@/lib/admin";
import { listarMensagens } from "@/lib/gestaoEmails/gmail";

// Rota temporária só pra validar a Fase 2 (autenticação + leitura real do
// Gmail via delegação de domínio) antes de construir a tela. Remover depois
// que a página em src/app/gestao-emails existir.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isMatheus(user?.email)) {
    return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 403 });
  }

  try {
    const mensagens = await listarMensagens({ query: "in:inbox newer_than:3d", maxResultados: 10 });
    return NextResponse.json({ ok: true, total: mensagens.length, mensagens });
  } catch (erro) {
    return NextResponse.json(
      { ok: false, erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
