import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROTAS_PUBLICAS = [
  "/login",
  "/signup",
  "/termos",
  "/esqueci-senha",
  "/redefinir-senha",
  "/api/erro-cliente",
  // Buscadas sem sessão: o Instagram busca a imagem do card direto, e o
  // Vercel Cron chama a coleta de notícias sem cookie — cada uma se
  // protege com o próprio segredo (CRON_SECRET) ou não expõe dado interno.
  "/api/social/imagem",
  "/api/cron",
  // Recebe eventos do Google Forms sem cookie de usuário. A rota valida um
  // token secreto próprio antes de ler o conteúdo ou criar qualquer card.
  "/api/integracoes/google-forms",
  // Formulário público de Capitalização — preenchido por imobiliárias,
  // corretores e proprietários que não têm (nem precisam ter) conta na
  // Plataforma O2.
  "/capitalizacao",
  // Formulário público de Seguro Fiança — mesma lógica da Capitalização.
  // O Google Forms "Ficha Fiança 5G" continua ativo em paralelo, sem
  // nenhuma alteração; esta é só uma via alternativa de entrada que já
  // cria o card diretamente no Bitrix.
  "/ficha-fianca",
];
const ROTAS_SO_DESLOGADO = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublica = ROTAS_PUBLICAS.some((r) => path.startsWith(r));
  const isSoDeslogado = ROTAS_SO_DESLOGADO.some((r) => path.startsWith(r));

  if (!user && !isPublica && path !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isSoDeslogado) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
