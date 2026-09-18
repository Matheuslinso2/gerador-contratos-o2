import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NOME_COOKIE_ACESSO_PUBLICO } from "@/lib/acessoPublico";

// Pedido do Matheus, 18/09/2026: Auditor de Contrato e Multa Rescisória não
// ficam mais abertas pra qualquer visitante que digitar a URL -- só quem
// abre este link (com o token certo) ganha um cookie liberando as duas
// ferramentas, sem precisar de login. O limite de 5 usos por IP em cada
// ferramenta continua igual, sem mudança. Ver src/proxy.ts (onde o cookie é
// exigido pra essas duas rotas) e acesso_publico_tokens no Supabase (onde o
// token é conferido).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("acesso_publico_tokens").select("id").eq("token", token).maybeSingle();

  const destino = data ? "/ferramentas" : "/";
  const resposta = NextResponse.redirect(new URL(destino, request.url));

  if (data) {
    // 1 ano -- é pra ser um acesso duradouro pra quem recebeu o link, não
    // só daquela visita.
    resposta.cookies.set(NOME_COOKIE_ACESSO_PUBLICO, "1", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return resposta;
}
