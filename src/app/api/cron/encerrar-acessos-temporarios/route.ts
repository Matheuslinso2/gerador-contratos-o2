import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Encerra os acessos temporários de imobiliária vencidos (tabela acessos_temporarios): apaga o login, solta a ficha
// (user_id nulo, e-mail e autorização como eram antes) para a imobiliária refazer o cadastro normal em /signup.
// Protegida por CRON_SECRET -- mesmo padrão das outras rotas de cron.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });

  const sb = createServiceClient();
  const { data: vencidos } = await sb.from("acessos_temporarios").select("*").is("encerrado_em", null).lte("expira_em", new Date().toISOString());
  const resultado: { email: string; ok: boolean; erro?: string }[] = [];
  for (const a of vencidos ?? []) {
    // Solta a ficha só se ainda for deste login (não mexe se alguém já vinculou outra conta).
    const { error: e1 } = await sb
      .from("imobiliarias")
      .update({ user_id: null, email: a.email_antes, autorizado: a.autorizado_antes ?? false })
      .eq("id", a.imobiliaria_id)
      .eq("user_id", a.auth_user_id);
    const { error: e2 } = await sb.auth.admin.deleteUser(a.auth_user_id);
    const erro = e1?.message ?? (e2 && !/not found/i.test(e2.message) ? e2.message : undefined);
    if (!erro) await sb.from("acessos_temporarios").update({ encerrado_em: new Date().toISOString() }).eq("id", a.id);
    resultado.push({ email: a.email, ok: !erro, erro });
  }
  return NextResponse.json({ ok: true, encerrados: resultado });
}
