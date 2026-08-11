import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  criarCardCapitalizacao,
  validarPayloadCapitalizacao,
  type CapitalizacaoFormPayload,
} from "@/lib/integracoes/capitalizacao";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function autorizado(request: NextRequest) {
  const secret = process.env.GOOGLE_FORMS_CAPITALIZACAO_SECRET;
  return Boolean(secret && request.headers.get("x-o2-integracao-token") === secret);
}
async function auditar(payload: CapitalizacaoFormPayload, status: string, itemId?: number, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert({
      origem: "google_forms_capitalizacao",
      resposta_id: payload.responseId,
      payload,
      status,
      bitrix_entity_type_id: 1048,
      bitrix_item_id: itemId ?? null,
      erro: erro ?? null,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "origem,resposta_id" });
  } catch (error) {
    console.warn("Auditoria da integração não persistida:", error);
  }
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 401 });

  let payload: CapitalizacaoFormPayload | undefined;
  try {
    payload = validarPayloadCapitalizacao(await request.json());
    await auditar(payload, "processando");
    const result = await criarCardCapitalizacao(payload);
    await auditar(payload, result.created ? "criado" : "duplicado", result.item.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (payload) await auditar(payload, "erro", undefined, message);
    return NextResponse.json({ ok: false, erro: message }, { status: 400 });
  }
}
