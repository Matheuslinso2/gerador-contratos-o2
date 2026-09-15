import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { processarLote } from "@/lib/campanhas/processarLote";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Chamada por polling da tela de progresso (src/app/campanhas/[id]/
// CampanhaProgresso.tsx) enquanto o admin acompanha o disparo -- caminho
// principal de envio, mais rápido que esperar o cron de rede de segurança.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  try {
    const resultado = await processarLote(id);
    return NextResponse.json(resultado);
  } catch (erro) {
    return NextResponse.json({ erro: erro instanceof Error ? erro.message : String(erro) }, { status: 500 });
  }
}
