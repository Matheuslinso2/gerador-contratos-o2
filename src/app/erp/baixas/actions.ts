"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { podeVerBaixas } from "@/lib/erp/acessoBaixas";

// ERP O2 — baixa de comissão assistida. Nada é escrito no Corp: aprovar grava o recebimento no ERP
// (erp_aprovar_baixa_extrato registra quem aprovou e quando) e alimenta a "lista pronta para o Corp".

async function exigirColaborador() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!podeVerBaixas(user?.email)) redirect("/erp");
  return { supabase, user };
}

export async function aprovarBaixa(formData: FormData) {
  const { supabase } = await exigirColaborador();
  const id = String(formData.get("extrato_id") ?? "");
  if (!id) redirect("/erp/baixas/gestao?erro=dados");

  const { data, error } = await supabase.rpc("erp_aprovar_baixa_extrato", { p_extrato: id });
  if (error) redirect(`/erp/baixas/gestao?erro=${encodeURIComponent(error.message)}`);

  const r = data as { recebimentos: number; parcelas_quitadas: number; para_tratar: number };
  revalidatePath("/erp/baixas"); revalidatePath("/erp/baixas/gestao");
  redirect(`/erp/baixas/gestao?aprovado=${r.recebimentos}&tratar=${r.para_tratar}#extrato-${id}`);
}

export async function salvarTratativa(formData: FormData) {
  const { supabase, user } = await exigirColaborador();
  const id = String(formData.get("linha_id") ?? "");
  const motivo = String(formData.get("tratar_motivo") ?? "").trim();
  const resolvido = formData.get("resolvido") === "on";
  if (!id) redirect("/erp/baixas/gestao?erro=dados");
  if (resolvido && !motivo) redirect("/erp/baixas/gestao?erro=" + encodeURIComponent("Escreva o motivo antes de marcar como resolvida.") + "#para-tratar");

  const { error } = await supabase
    .from("erp_extrato_linhas")
    .update({
      tratar_motivo: motivo || null,
      tratar_resolvido_em: resolvido ? new Date().toISOString() : null,
      tratar_por_email: user?.email ?? null,
    })
    .eq("id", id);
  if (error) redirect(`/erp/baixas/gestao?erro=${encodeURIComponent(error.message)}#para-tratar`);

  revalidatePath("/erp/baixas"); revalidatePath("/erp/baixas/gestao");
  redirect("/erp/baixas/gestao?sucesso=1#para-tratar");
}
