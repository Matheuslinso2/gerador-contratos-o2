import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { perfilDoEmail } from "@/lib/painelComercial/acesso";
import { montarDocumentoPainel } from "@/lib/painelComercial/documento";

export const dynamic = "force-dynamic";

// Documento do Painel Comercial v5 (carregado dentro do iframe de
// /painel-comercial). Sem login/perfil não entrega nem o HTML.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !perfilDoEmail(user.email)) return new NextResponse("Sem acesso", { status: 403 });
  return new NextResponse(montarDocumentoPainel(), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0" },
  });
}
