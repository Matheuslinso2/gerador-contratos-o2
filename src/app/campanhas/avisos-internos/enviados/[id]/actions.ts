"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarPendentesDoAviso } from "@/lib/avisosInternos/envio";

// Manda o aviso (mesmo HTML já gravado no histórico) só pra quem ainda não
// recebeu: envios que falharam ou que ficaram pendentes quando o tempo do
// primeiro disparo acabou.
export async function enviarParaQuemFaltou(formData: FormData) {
  const avisoId = String(formData.get("aviso_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const { data: aviso } = await supabase.from("avisos_internos_historico").select("id, assunto, html").eq("id", avisoId).single();
  if (!aviso) redirect("/campanhas/avisos-internos");

  const resultado = await enviarPendentesDoAviso(supabase, aviso);
  const base = `/campanhas/avisos-internos/enviados/${aviso.id}`;

  if (resultado.enviados === 0 && resultado.falhas > 0) {
    redirect(`${base}?erro=${encodeURIComponent(resultado.primeiroErro ?? "Não foi possível enviar.")}`);
  }
  const faltam = resultado.falhas + resultado.restantes;
  redirect(
    `${base}?ok=${encodeURIComponent(
      faltam ? `Enviado pra ${resultado.enviados} pessoa(s); ${faltam} ainda faltam.` : `Enviado pra ${resultado.enviados} pessoa(s) que faltavam.`
    )}`
  );
}
