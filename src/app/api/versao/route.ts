import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Diz qual publicação (deploy) está no ar agora. O aviso "o sistema foi
// atualizado" (components/AvisoNovaVersao.tsx) compara este valor com o da
// página que a pessoa deixou aberta -- ver o motivo lá. Pública (entra em
// ROTAS_PUBLICAS no proxy) porque só devolve um código de versão.
export async function GET() {
  return NextResponse.json({ id: process.env.VERCEL_GIT_COMMIT_SHA ?? "local" }, { headers: { "Cache-Control": "no-store" } });
}
