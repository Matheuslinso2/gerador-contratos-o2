import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tokenBitrixValido } from "@/lib/bitrix/emailNoCard";

export const dynamic = "force-dynamic";

// Imagem colada ou inserida no corpo do e-mail do card: o navegador sobe direto
// pro bucket público email-imagens com a URL assinada daqui (mesmo esquema dos
// anexos, anexo-upload-url/route.ts) e o e-mail leva só o link da imagem -- o
// Gmail/Outlook de quem recebe não abrem imagem embutida no próprio texto.
const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;
const EXTENSAO_POR_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function POST(request: NextRequest) {
  let body: { authId?: string; entityTypeId?: number; itemId?: number; tipo?: string; tamanho?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { authId, entityTypeId, itemId, tipo, tamanho } = body;
  if (!authId || !(await tokenBitrixValido(authId))) {
    return NextResponse.json({ ok: false, erro: "Sessão do Bitrix inválida. Recarregue a aba e tente de novo." }, { status: 401 });
  }
  if (!entityTypeId || !itemId || !tipo) {
    return NextResponse.json({ ok: false, erro: "Dados incompletos." }, { status: 400 });
  }
  const extensao = EXTENSAO_POR_TIPO[tipo];
  if (!extensao) {
    return NextResponse.json({ ok: false, erro: "Formato de imagem não aceito (use PNG, JPG, GIF ou WebP)." }, { status: 400 });
  }
  if (typeof tamanho === "number" && tamanho > TAMANHO_MAXIMO_BYTES) {
    return NextResponse.json({ ok: false, erro: "Imagem maior que 5 MB." }, { status: 400 });
  }

  const caminho = `${entityTypeId}-${itemId}/${crypto.randomUUID()}.${extensao}`;
  const { data, error } = await createServiceClient().storage.from("email-imagens").createSignedUploadUrl(caminho);
  if (error || !data) {
    console.error("Falha ao gerar URL assinada de upload de imagem:", error);
    return NextResponse.json({ ok: false, erro: "Falha ao preparar o envio da imagem." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, caminho: data.path, token: data.token });
}
