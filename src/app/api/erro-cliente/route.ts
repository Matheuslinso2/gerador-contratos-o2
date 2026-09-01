import { NextRequest, NextResponse } from "next/server";
import { alertarAdmin } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

// error.tsx roda no cliente e não pode chamar o envio de e-mail diretamente
// (é código de servidor), então ele reporta pra essa rota, que dispara o
// alerta de verdade. A rota em si não exige login (erro pode acontecer até
// na tela de login), mas aqui a gente tenta identificar quem estava
// logado no momento, pra dizer no alerta qual imobiliária foi afetada.
export async function POST(request: NextRequest) {
  const { mensagem, digest, url } = await request.json();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let nomeImobiliaria: string | null = null;
  if (user) {
    const { data } = await supabase.from("imobiliarias").select("nome").eq("user_id", user.id).maybeSingle();
    nomeImobiliaria = data?.nome ?? null;
  }

  const quem = nomeImobiliaria
    ? `${nomeImobiliaria} (${user?.email})`
    : user?.email
      ? user.email
      : "usuário não identificado / não logado";

  await alertarAdmin({
    contexto: `Erro na interface — ${nomeImobiliaria ?? user?.email ?? "visitante"}`,
    quem,
    detalhe: `URL: ${url ?? "desconhecida"}\nDigest: ${digest ?? "-"}\nMensagem: ${mensagem ?? "-"}`,
  });

  return NextResponse.json({ ok: true });
}
