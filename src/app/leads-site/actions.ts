"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

const STATUS_VALIDOS = ["novo", "contatado", "qualificado", "descartado"];

// Acompanhamento interno do lead do site (sem Bitrix): status + observações.
// O 1º status diferente de "novo" marca primeiro_contato_em -- é daí que sai o
// "tempo até o primeiro contato" do painel.
export async function atualizarAcompanhamentoLead(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) return;

  const id = String(formData.get("lead_id") ?? "");
  const status = String(formData.get("status_interno") ?? "");
  const observacoes = String(formData.get("observacoes") ?? "").trim().slice(0, 2000);
  if (!id || !STATUS_VALIDOS.includes(status)) return;

  const { data: atual } = await supabase.from("leads_site_o2seguros").select("primeiro_contato_em").eq("id", id).maybeSingle();
  const agora = new Date().toISOString();

  await supabase
    .from("leads_site_o2seguros")
    .update({
      status_interno: status,
      observacoes: observacoes || null,
      atualizado_por: user?.email ?? null,
      atualizado_em: agora,
      primeiro_contato_em: status !== "novo" && !atual?.primeiro_contato_em ? agora : atual?.primeiro_contato_em ?? null,
    })
    .eq("id", id);

  revalidatePath("/leads-site");
}
