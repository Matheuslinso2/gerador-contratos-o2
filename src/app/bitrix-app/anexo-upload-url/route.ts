import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tokenBitrixValido, BUCKET_ANEXOS } from "@/lib/bitrix/emailNoCard";

export const dynamic = "force-dynamic";

// Fase 4 (anexos) do e-mail no card -- ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md. O arquivo
// NUNCA passa pela nossa função: o navegador sobe direto pro Supabase
// Storage usando a URL assinada daqui, contornando o limite de 4,5MB do
// corpo de requisição do Vercel (que se aplica só ao que chega NESTA
// função, não ao envio direto do navegador pro Storage). enviar-email/route.ts
// busca o arquivo de volta do Storage só na hora de montar o e-mail de
// verdade (chamada de servidor, sem esse limite).
const TAMANHO_MAXIMO_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let body: { authId?: string; entityTypeId?: number; itemId?: number; nomeArquivo?: string; tamanho?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { authId, entityTypeId, itemId, nomeArquivo, tamanho } = body;

  if (!authId || !(await tokenBitrixValido(authId))) {
    return NextResponse.json({ ok: false, erro: "Sessão do Bitrix inválida." }, { status: 401 });
  }

  if (!entityTypeId || !itemId || !nomeArquivo) {
    return NextResponse.json({ ok: false, erro: "Dados incompletos." }, { status: 400 });
  }

  if (typeof tamanho === "number" && tamanho > TAMANHO_MAXIMO_BYTES) {
    return NextResponse.json({ ok: false, erro: "Arquivo maior que 15 MB." }, { status: 400 });
  }

  const caminho = `${entityTypeId}-${itemId}/${crypto.randomUUID()}-${nomeArquivo}`;

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUploadUrl(caminho);

  if (error || !data) {
    console.error("Falha ao gerar URL assinada de upload de anexo:", error);
    return NextResponse.json({ ok: false, erro: "Falha ao preparar envio do anexo." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, caminho: data.path, token: data.token });
}
