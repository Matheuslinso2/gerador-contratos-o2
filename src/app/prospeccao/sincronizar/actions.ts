"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { sincronizarPlanilhas } from "@/lib/prospeccaoSync";

export async function sincronizarAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const forcarTudo = formData.get("forcar_tudo") === "on";
  const resultado = await sincronizarPlanilhas(supabase, forcarTudo);

  if (resultado.erros.length) {
    console.error("[prospeccao][sync] erros:", resultado.erros);
  }

  const resumo =
    `${resultado.arquivos_processados.length} planilha(s) atualizada(s), ` +
    `${resultado.linhas_gravadas} linha(s) gravada(s), ` +
    `${resultado.arquivos_ja_atualizados} já estavam em dia, ` +
    `${resultado.estatisticas_calculadas} estatística(s) recalculada(s)` +
    (resultado.erros.length ? `, ${resultado.erros.length} erro(s) (veja os Vercel Runtime Logs)` : ".");

  redirect(`/prospeccao/sincronizar?resultado=${encodeURIComponent(resumo)}`);
}
