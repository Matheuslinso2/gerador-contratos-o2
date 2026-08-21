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
  // Formulário público de Seguro Incêndio (residencial, empresarial e
  // imobiliário) — mesma lógica. O Google Forms "Ficha online - Seguro
  // Incêndio" continua ativo em paralelo, sem nenhuma alteração.
  "/seguro-incendio",
  // Formulário público de RC Obras (Seguro de Responsabilidade Civil de
  // Obras) — ainda sem SPA no Bitrix, então não cria card: só envia e-mail
  // pra incendio@o2seguros.com.br e registra na planilha compartilhada de
  // conferência (ver src/app/rc-obras/actions.ts).
  "/rc-obras",
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

  // Registro de uso diário (não é log de login -- ver
  // supabase/schema_acessos_diarios.sql). Chama em toda requisição
  // autenticada -- sem throttle por cookie -- pra ultimo_acesso refletir a
  // atividade real da pessoa ao longo do dia, não só a primeira requisição.
  // registrar_acesso_diario já faz upsert (ON CONFLICT DO UPDATE), então
  // primeiro_acesso é preenchido só uma vez (default now() do INSERT) e as
  // chamadas seguintes só atualizam ultimo_acesso/qtd_requisicoes.
  if (user?.email) {
    const { error } = await supabase.rpc("registrar_acesso_diario", { p_email: user.email });
    if (error) {
      console.error("[registro-acesso-diario] falhou para", user.email, error.message);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
