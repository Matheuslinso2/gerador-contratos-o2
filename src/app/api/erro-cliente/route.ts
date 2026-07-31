import { NextRequest, NextResponse } from "next/server";
import { alertarAdmin } from "@/lib/email";

// error.tsx roda no cliente e não pode chamar nodemailer diretamente (é
// código de servidor), então ele reporta pra essa rota, que dispara o
// alerta de verdade.
export async function POST(request: NextRequest) {
  const { mensagem, digest, url } = await request.json();

  await alertarAdmin({
    contexto: "Erro na interface (error boundary)",
    detalhe: `URL: ${url ?? "desconhecida"}\nDigest: ${digest ?? "-"}\nMensagem: ${mensagem ?? "-"}`,
  });

  return NextResponse.json({ ok: true });
}
