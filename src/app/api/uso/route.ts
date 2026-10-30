import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Uso real do Workspace (reunião Kamila 29/10/2026): o navegador manda de
// tempos em tempos quantas TELAS (trocas de página) e CLIQUES a pessoa fez.
// Só conta pra quem está logado, em nome do próprio e-mail (RLS garante).
export async function POST(request: NextRequest) {
  let corpo: { telas?: unknown; cliques?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // Limite por envio: evita número absurdo vindo de um navegador adulterado.
  const limitar = (v: unknown) => Math.max(0, Math.min(Math.floor(Number(v) || 0), 500));
  const telas = limitar(corpo.telas);
  const cliques = limitar(corpo.cliques);
  if (!telas && !cliques) return NextResponse.json({ ok: true });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ ok: false }, { status: 401 });
  const { error } = await supabase.rpc("registrar_uso_cliente", { p_email: user.email, p_telas: telas, p_cliques: cliques });
  if (error) console.error("[uso] falhou para", user.email, error.message);
  return NextResponse.json({ ok: !error });
}
