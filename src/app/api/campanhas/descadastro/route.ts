import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validarTokenDescadastro } from "@/lib/campanhas/unsubscribeToken";

export const dynamic = "force-dynamic";

// Endpoint do header List-Unsubscribe-Post (RFC 8058) -- Gmail/Outlook
// fazem esse POST direto quando a pessoa clica "Cancelar inscrição" na
// própria interface deles, sem abrir nenhuma tela. O cliente de e-mail já
// exige um clique explícito antes de disparar o POST, então processa o
// opt-out imediatamente (diferente da página pública, que é GET e não
// processa sozinha por causa de prefetch de scanners).
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get("email") ?? "").trim().toLowerCase();
  const token = searchParams.get("token") ?? "";
  const campanhaId = searchParams.get("campanha_id") || null;

  if (!email || !token || !validarTokenDescadastro(email, token)) {
    return NextResponse.json({ erro: "link inválido" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("campanhas_descadastros")
    .upsert({ email, origem_campanha_id: campanhaId }, { onConflict: "email" });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
