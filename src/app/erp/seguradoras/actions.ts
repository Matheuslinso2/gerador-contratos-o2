"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// ERP O2 — Fase 1a: regra de pagamento de comissão por seguradora.
// Quem edita: equipe O2 (Matheus, Nathalie). Fica registrado quem confirmou e quando.

export async function salvarRegraSeguradora(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const id = String(formData.get("id") ?? "");
  const regra = String(formData.get("regra_comissao") ?? "proporcional");
  const ateRaw = String(formData.get("esgotamento_ate_parcelas") ?? "").trim();
  const prazoRaw = String(formData.get("prazo_pagamento_dias") ?? "").trim();
  const diaRaw = String(formData.get("dia_fixo_parcela") ?? "").trim();
  const obs = String(formData.get("regra_observacao") ?? "").trim();
  const confirmada = formData.get("regra_confirmada") === "on";

  if (!id || !["proporcional", "esgotamento"].includes(regra)) redirect("/erp/seguradoras?erro=dados");

  const ate = ateRaw ? Number(ateRaw) : null;
  const prazo = prazoRaw ? Number(prazoRaw) : 5;
  const dia = diaRaw ? Number(diaRaw) : null;
  if ((ate !== null && !(ate >= 1 && ate <= 24)) || !(prazo >= 0 && prazo <= 60) || (dia !== null && !(dia >= 1 && dia <= 28))) {
    redirect("/erp/seguradoras?erro=dados");
  }

  const { error } = await supabase
    .from("erp_seguradoras")
    .update({
      regra_comissao: regra,
      esgotamento_ate_parcelas: regra === "esgotamento" ? ate : null,
      prazo_pagamento_dias: prazo,
      dia_fixo_parcela: dia,
      regra_observacao: obs || null,
      regra_confirmada_em: confirmada ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq("id", id);
  if (error) redirect(`/erp/seguradoras?erro=${encodeURIComponent(error.message)}`);

  revalidatePath("/erp/seguradoras");
  redirect("/erp/seguradoras?sucesso=1");
}
