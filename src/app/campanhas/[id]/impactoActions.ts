"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { recalcularAndamento } from "@/lib/campanhas/impactoCampanha";

// Botão "Atualizar andamento" do quadro Impacto da campanha (03/11/2026): recalcula a produção até hoje
// de cada participante e a leitura provisória. A foto de partida (tendência e baseline) não muda.
export async function atualizarAndamento(campanhaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  let texto: string;
  let chave: "ok" | "erro" = "ok";
  try {
    const r = await recalcularAndamento(createServiceClient(), campanhaId);
    texto = `Andamento atualizado até ${r.ate.slice(8, 10)}/${r.ate.slice(5, 7)} para ${r.participantes} participante(s).`;
  } catch (e) {
    chave = "erro";
    texto = e instanceof Error ? e.message : "Não consegui atualizar o andamento.";
  }
  redirect(`/campanhas/${campanhaId}?${chave}=${encodeURIComponent(texto)}#impacto`);
}
