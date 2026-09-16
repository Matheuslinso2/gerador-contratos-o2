import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Inicia a conexão da conta do Instagram da O2 com a API oficial da Meta --
// só admin (não colaborador O2 em geral), porque guarda um token de acesso
// à conta oficial. Fluxo: gera um "state" aleatório (proteção contra
// CSRF -- confirmado no callback), guarda num cookie de curta duração, e
// redireciona pro login do Instagram.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) return NextResponse.redirect(new URL("/", request.url));

  const appId = process.env.INSTAGRAM_APP_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!appId || !siteUrl) {
    return NextResponse.json(
      { erro: "INSTAGRAM_APP_ID ou NEXT_PUBLIC_SITE_URL não configuradas no Vercel." },
      { status: 500 }
    );
  }

  const state = randomUUID();

  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", `${siteUrl}/api/instagram/callback`);
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  const resposta = NextResponse.redirect(url);
  resposta.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 min -- só precisa sobreviver até o Instagram redirecionar de volta
    path: "/",
  });
  return resposta;
}
