import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isEquipe } from "@/lib/admin";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";

// Volta do "Entrar com Google" (login/actions.ts). Fica dentro de /login pra
// ser rota pública no proxy.ts sem precisar de exceção nova.
//
// O Supabase cria a conta sozinho se o e-mail do Google ainda não existir --
// mas cadastro de imobiliária só nasce pelo /signup (CNPJ, autorização da
// O2). Então: equipe O2 entra sempre; quem já tem conta com o mesmo e-mail
// entra (o Supabase junta o Google à conta existente); e-mail desconhecido
// tem a conta recém-criada apagada e volta pro login com aviso.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const voltar = (params: string) => NextResponse.redirect(new URL(`/login?${params}`, request.url));
  if (!code) return voltar(`erro=${encodeURIComponent("Login com Google cancelado.")}`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const user = data?.user;
  if (error || !user) return voltar(`erro=${encodeURIComponent("Não foi possível concluir o login com Google. Tente de novo.")}`);

  if (isEquipe(user.email)) return NextResponse.redirect(new URL("/", request.url));

  const imobiliaria = await buscarImobiliariaDoUsuario(supabase, user);
  if (imobiliaria) return NextResponse.redirect(new URL("/", request.url));

  await supabase.auth.signOut();
  const criadaAgora = Date.now() - new Date(user.created_at).getTime() < 5 * 60_000;
  const soGoogle = (user.identities ?? []).every((i) => i.provider === "google");
  if (criadaAgora && soGoogle) {
    await createServiceClient().auth.admin.deleteUser(user.id);
  }
  return voltar(
    `erro=${encodeURIComponent("Não encontramos cadastro com este e-mail do Google. Crie sua conta em \"Criar conta\" ou entre com o e-mail cadastrado.")}`
  );
}
