import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { TEXTO_PADRAO_PARCIAL_HTML, destinoSeguro, extrairBotoes } from "@/lib/campanhas/parcialCampanha";

export const dynamic = "force-dynamic";

// Clique no botão do e-mail de parcial (03/11/2026). Redireciona para o destino
// que está no TEXTO SALVO da parcial (nunca para um endereço vindo da URL, para
// não virar redirecionamento aberto) e registra o clique só depois do envio real
// (prévia e teste não contam).
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const fallback = "https://wa.me/5521979349415";
  if (!/^[a-f0-9]{16,64}$/.test(token)) return NextResponse.redirect(fallback, 302);
  const indice = Number(request.nextUrl.searchParams.get("b") ?? "0");
  const db = createServiceClient();
  const { data } = await db.from("campanhas_panoramas").select("id, status, texto").eq("token", token).maybeSingle();
  if (!data || data.status === "descartada") return NextResponse.redirect(fallback, 302);

  const botoes = extrairBotoes(data.texto || TEXTO_PADRAO_PARCIAL_HTML);
  const existe = Number.isInteger(indice) && indice >= 0 && indice < botoes.length;
  const destino = (existe ? destinoSeguro(botoes[indice]) : null) ?? fallback;
  if (data.status === "enviada" && existe) {
    try {
      await db.from("campanhas_panoramas_eventos").insert({ panorama_id: data.id, tipo: "clique_botao", botao: indice, agente: "navegador" });
    } catch {
      // registrar o clique nunca impede o redirecionamento
    }
  }
  return NextResponse.redirect(destino, 302);
}
