"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { validarTokenDescadastro } from "@/lib/campanhas/unsubscribeToken";

// Só processa o opt-out quando a pessoa clica em "Confirmar" nesta Server
// Action -- a página em si (GET) só valida o token e mostra a tela, pra não
// descadastrar por engano com o prefetch de scanners de antivírus/Outlook
// que abrem todo link de um e-mail automaticamente.
export async function confirmarDescadastro(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "");
  const campanhaId = String(formData.get("campanha_id") ?? "").trim() || null;

  if (!email || !token || !validarTokenDescadastro(email, token)) {
    redirect("/campanhas/descadastro?erro=1");
  }

  const supabase = createServiceClient();
  await supabase.from("campanhas_descadastros").upsert({ email, origem_campanha_id: campanhaId }, { onConflict: "email" });

  redirect(`/campanhas/descadastro?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&ok=1`);
}
