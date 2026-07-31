"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

export async function registrarResultadoVisita(id: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const temperatura = String(formData.get("resultado_temperatura") ?? "").trim() || null;
  const estagio = String(formData.get("resultado_estagio") ?? "").trim() || null;
  const proximoPasso = String(formData.get("resultado_proximo_passo") ?? "").trim() || null;
  const dataProximoPassoRaw = String(formData.get("resultado_data_proximo_passo") ?? "").trim();
  const observacoes = String(formData.get("resultado_observacoes") ?? "").trim() || null;

  await supabase
    .from("relatorios_prospeccao")
    .update({
      resultado_temperatura: temperatura,
      resultado_estagio: estagio,
      resultado_proximo_passo: proximoPasso,
      resultado_data_proximo_passo: dataProximoPassoRaw || null,
      resultado_observacoes: observacoes,
      resultado_atualizado_em: new Date().toISOString(),
    })
    .eq("id", id);

  redirect(`/prospeccao/${id}`);
}
