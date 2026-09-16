import { NextRequest, NextResponse } from "next/server";
import { trocarCodePorTokenCurto, trocarPorTokenLongo, obterContaDoToken, salvarAuth } from "@/lib/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // 3 chamadas HTTP em sequência (curto -> longo -> conta)

// Recebe o retorno do login do Instagram (ver /api/instagram/conectar),
// troca o "code" por token curto -> longo (60 dias), descobre a conta, e
// salva tudo em instagram_auth. Único lugar do fluxo que lida com o code de
// autorização -- se der erro em qualquer passo, redireciona de volta pra
// /social-media com uma mensagem, nunca deixa o segredo vazar na URL.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const erroOAuth = searchParams.get("error_description") || searchParams.get("error");
  const stateEsperado = request.cookies.get("ig_oauth_state")?.value;

  function redirecionarComErro(mensagem: string) {
    const resposta = NextResponse.redirect(
      new URL(`/social-media?instagram_erro=${encodeURIComponent(mensagem)}`, request.url)
    );
    resposta.cookies.delete("ig_oauth_state");
    return resposta;
  }

  if (erroOAuth) return redirecionarComErro(`Login cancelado ou negado: ${erroOAuth}`);
  if (!code) return redirecionarComErro("O Instagram não devolveu o código de autorização.");
  if (!state || !stateEsperado || state !== stateEsperado) {
    return redirecionarComErro("Verificação de segurança falhou (state inválido) -- tente conectar de novo.");
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return redirecionarComErro("NEXT_PUBLIC_SITE_URL não configurada no Vercel.");

  try {
    const { accessToken: tokenCurto } = await trocarCodePorTokenCurto(code, `${siteUrl}/api/instagram/callback`);
    const { accessToken: tokenLongo, expiresInSegundos } = await trocarPorTokenLongo(tokenCurto);
    const conta = await obterContaDoToken(tokenLongo);

    await salvarAuth({
      accessToken: tokenLongo,
      instagramBusinessAccountId: conta.userId,
      instagramUsername: conta.username,
      expiresInSegundos,
    });

    const resposta = NextResponse.redirect(new URL("/social-media?instagram=conectado", request.url));
    resposta.cookies.delete("ig_oauth_state");
    return resposta;
  } catch (erro) {
    return redirecionarComErro(erro instanceof Error ? erro.message : String(erro));
  }
}
