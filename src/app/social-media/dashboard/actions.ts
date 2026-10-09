"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { atualizarMetricasPosts } from "@/lib/social/metricas";

export async function atualizarMetricasAgora() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(isAdmin(user.email) || isColaboradorO2(user.email))) redirect("/login");

  const resultado = await atualizarMetricasPosts(supabase);
  revalidatePath("/social-media/dashboard");

  if (!resultado.ok) {
    redirect(`/social-media/dashboard?erro=${encodeURIComponent(resultado.erro)}`);
  }
  redirect(`/social-media/dashboard?atualizados=${resultado.atualizados}${resultado.semInsights ? "&sem_insights=1" : ""}`);
}
