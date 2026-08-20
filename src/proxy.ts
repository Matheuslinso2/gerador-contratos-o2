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
  // Recebe e-mails da caixa incendio@ via gatilho do Google Apps Script,
  // sem cookie de usuário. Valida um token secreto próprio (mesmo padrão).
  "/api/integracoes/incendio-email",
  // Formulário público de Capitalização — preenchido por imobiliárias,
  // corretores e proprietários que não têm (nem precisam ter) conta na
  // Plataforma O2.
  "/capitalizacao",
  // Formulário público de Seguro Fiança — mesma lógica da Capitalização.
  // O Google Forms "Ficha Fiança 5G" continua ativo em paralelo, sem
  // nenhuma alteração; esta é só uma via alternativa de entrada que já
  // cria o card diretamente no Bitrix.
  "/ficha-fianca",
  // Formulário público de Seguro Auto — mesma lógica. Ainda não cria card
  // no Bitrix (SPA não existe ainda), só registra em
  // integracao_formularios_log até a integração ser ligada.
  "/seguro-auto",
];
const ROTAS_SO_DESLOGADO = ["/login", "/signup"];

// "Dia" em horário de Brasília (não UTC) -- usado só pro nome do cookie de
// throttle abaixo; o registro em si usa o relógio do próprio Postgres (ver
// registrar_acesso_diario em supabase/schema_acessos_diarios.sql).
function diaBrasilia(): string {
  const brasilia = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return brasilia.toISOString().slice(0, 10);
}

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

  // Registro de uso diário (não é log de login -- ver
  // supabase/schema_acessos_diarios.sql) -- throttled por cookie pra não
  // bater no banco em toda requisição, só na primeira do dia.
  if (user?.email) {
    const cookieAcesso = `wsacesso_${diaBrasilia()}`;
    if (!request.cookies.get(cookieAcesso)) {
      const { error } = await supabase.rpc("registrar_acesso_diario", { p_email: user.email });
      if (!error) {
        response.cookies.set(cookieAcesso, "1", { maxAge: 60 * 60 * 26, httpOnly: true });
      } else {
        console.error("[registro-acesso-diario] falhou para", user.email, error.message);
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
