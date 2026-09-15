"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// Lógica invertida (pedido da reunião de 15/09/2026): selecionar
// destinatários só grava a seleção na própria campanha -- o botão de
// disparo passa a aparecer na tela da campanha DEPOIS disso, em vez da
// seleção levar direto pra revisão/disparo.
export async function salvarDestinatarios(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const imobiliariaIds = formData.getAll("imob").map(String).filter(Boolean);
  const contatosExternosIds = formData.getAll("contato_externo").map(String).filter(Boolean);

  const { data: campanha } = await supabase.from("campanhas").select("id, status").eq("id", campanhaId).single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "rascunho") redirect(`/campanhas/${campanhaId}`);

  await supabase
    .from("campanhas")
    .update({ imobiliarias_selecionadas: imobiliariaIds, contatos_externos_selecionados: contatosExternosIds })
    .eq("id", campanhaId);

  redirect(`/campanhas/${campanhaId}`);
}
