import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { NOME_COOKIE_ACESSO_PUBLICO, ROTAS_PUBLICAS_COM_COOKIE } from "@/lib/acessoPublico";

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
  // Recebe a resposta do cliente ao e-mail enviado pelo card (Fase 2 do
  // e-mail no card), via Cloudflare Email Worker -- mesmo padrão de token
  // secreto próprio dos outros webhooks acima.
  "/api/integracoes/bitrix-email-resposta",
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
  // Formulários públicos de Seguro Celular, RCP e Condomínio — mesma
  // lógica do RC Obras: sem SPA no Bitrix ainda, só e-mail pra
  // comercial@o2seguros.com.br + planilha compartilhada de conferência.
  "/seguro-celular",
  "/rcp",
  "/condominio",
  // Vitrine pública que reúne as fichas acima num link só — a pessoa
  // escolhe o produto e é levada pra rota individual de sempre (nenhuma
  // delas muda). Ver src/lib/produtosLandingPage.tsx (fonte única).
  "/cotacao",
  // Placement/handler do aplicativo local do Bitrix (e-mail dentro do card
  // do Sucesso do Cliente) -- o Bitrix chama essa URL direto (instalação e
  // toda abertura da aba), sem cookie de sessão nenhum. Não tem segredo
  // compartilhado como os outros webhooks acima porque o próprio handshake
  // OAuth (AUTH_ID/REFRESH_ID) é o que autentica -- ver
  // src/lib/bitrix/appAuth.ts. Ver
  // C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md.
  "/bitrix-app",
  // Descadastro de Campanhas Comerciais -- quem clica não necessariamente
  // tem login no Workspace (destinatário é a imobiliária, não a equipe O2).
  // Cada rota valida o próprio token HMAC (ver src/lib/campanhas/
  // unsubscribeToken.ts), não depende de sessão.
  "/campanhas/descadastro",
  "/api/campanhas/descadastro",
  // Webhook do Resend (abertura/clique de campanha) -- chamado direto pelo
  // Resend, sem cookie de sessão. Valida a própria assinatura Svix/HMAC
  // (ver src/app/api/campanhas/webhook-resend/route.ts), mesmo padrão dos
  // outros webhooks acima.
  "/api/campanhas/webhook-resend",
  // Verificação do link de acesso público (pedido do Matheus, 18/09/2026) --
  // só confere o token e libera o cookie (ver src/app/acesso/[token]/
  // route.ts); não expõe nada além disso, então pode ser público de
  // verdade. As duas ferramentas que esse link libera (Auditor de Contrato
  // e Multa Rescisória) NÃO entram aqui -- ver ROTAS_PUBLICAS_COM_COOKIE
  // abaixo, só ficam públicas pra quem já tem o cookie.
  "/acesso",
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
  // Auditor de Contrato e Multa Rescisória (pedido do Matheus, 18/09/2026):
  // só ficam abertas sem login pra quem já tem o cookie liberado por
  // /acesso/<token> -- quem digitar a URL direto sem esse cookie cai no
  // /login normal, igual o resto do Workspace.
  const temCookieAcessoPublico = request.cookies.get(NOME_COOKIE_ACESSO_PUBLICO)?.value === "1";
  const isPublicaComCookie = ROTAS_PUBLICAS_COM_COOKIE.some((r) => path.startsWith(r)) && temCookieAcessoPublico;

  if (!user && !isPublica && !isPublicaComCookie && path !== "/") {
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
