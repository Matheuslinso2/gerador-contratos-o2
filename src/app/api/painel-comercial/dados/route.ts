import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { filtrarPorPerfil, perfilDoEmail, visaoDoPerfil } from "@/lib/painelComercial/acesso";
import { obterRetrato } from "@/lib/painelComercial/retrato";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Datasets do Painel Comercial v5. O perfil vem da sessão (e-mail da conta
// logada), nunca de parâmetro da URL; a comissão individual é filtrada AQUI.
// Resposta privada e sem cache: o conteúdo muda por pessoa.
const CABECALHOS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perfil = perfilDoEmail(user?.email);
  if (!user || !perfil) return NextResponse.json({ erro: "sem acesso" }, { status: 403, headers: CABECALHOS });

  try {
    const retrato = await obterRetrato(request.nextUrl.searchParams.get("atualizar") === "1" && perfil.tipo !== "vendedora");
    return NextResponse.json({ geradoEm: retrato.geradoEm, visao: visaoDoPerfil(perfil), dados: filtrarPorPerfil(retrato.dados, perfil) }, { headers: CABECALHOS });
  } catch (e) {
    console.error("Painel Comercial v5:", e);
    return NextResponse.json({ erro: "Não consegui ler os dados do Bitrix agora." }, { status: 502, headers: CABECALHOS });
  }
}
