import { NextRequest, NextResponse } from "next/server";
import { alertarAdmin } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";

// error.tsx roda no cliente e não pode chamar o envio de e-mail diretamente
// (é código de servidor), então ele reporta pra essa rota, que dispara o
// alerta de verdade. A rota em si não exige login (erro pode acontecer até
// na tela de login), mas aqui a gente tenta identificar quem estava
// logado no momento, pra dizer no alerta qual imobiliária foi afetada.
//
// Por ser pública (revisão de segurança 30/10/2026, item 5): só aceita
// chamada do próprio site, corta textos grandes e limita quantos e-mails
// saem por IP e no total. O limite fica na memória da função -- não é
// global entre instâncias da Vercel, mas segura rajada/spam simples; o erro
// continua indo pro Sentry de qualquer jeito (error.tsx).

const TAMANHO_MAX_CORPO = 8_000;
const JANELA_MS = 10 * 60_000;
const MAX_POR_IP = 5;
const MAX_TOTAL = 40;
const envios = new Map<string, number[]>();

function passouDoLimite(ip: string): boolean {
  const agora = Date.now();
  const recentes = (chave: string) => (envios.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
  const doIp = recentes(ip);
  const total = recentes("*");
  if (doIp.length >= MAX_POR_IP || total.length >= MAX_TOTAL) return true;
  envios.set(ip, [...doIp, agora]);
  envios.set("*", [...total, agora]);
  if (envios.size > 5_000) envios.clear();
  return false;
}

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

export async function POST(request: NextRequest) {
  let hostOrigem: string | null = null;
  try {
    hostOrigem = new URL(request.headers.get("origin") ?? "").host;
  } catch {}
  if (!hostOrigem || hostOrigem !== request.headers.get("host")) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const corpo = await request.text();
  if (corpo.length > TAMANHO_MAX_CORPO) return NextResponse.json({ ok: false }, { status: 413 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  if (passouDoLimite(ip)) return NextResponse.json({ ok: false }, { status: 429 });

  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const mensagem = texto(dados.mensagem, 2_000);
  const digest = texto(dados.digest, 100);
  const url = texto(dados.url, 500);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let nomeImobiliaria: string | null = null;
  if (user) {
    const imobiliaria = await buscarImobiliariaDoUsuario(supabase, user);
    nomeImobiliaria = imobiliaria?.nome ?? null;
  }

  const quem = nomeImobiliaria
    ? `${nomeImobiliaria} (${user?.email})`
    : user?.email
      ? user.email
      : "usuário não identificado / não logado";

  await alertarAdmin({
    contexto: `Erro na interface — ${nomeImobiliaria ?? user?.email ?? "visitante"}`,
    quem,
    detalhe: `URL: ${url ?? "desconhecida"}\nIP: ${ip}\nDigest: ${digest ?? "-"}\nMensagem: ${mensagem ?? "-"}`,
  });

  return NextResponse.json({ ok: true });
}
