"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isMatheus } from "@/lib/admin";
import { montarRelatorioDiario, parametrosModelo, MODELO_WHATSAPP } from "@/lib/relatorioDiario/montar";
import { enviarModeloWhatsApp, destinatariosRelatorio } from "@/lib/whatsapp";

// Envia o relatório de agora SÓ pro primeiro número da lista (o do
// Matheus), pra testar o modelo aprovado antes de ligar pra todos.
export async function enviarTesteWhatsApp() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) redirect("/");

  const [numero] = destinatariosRelatorio();
  let destino = "/admin/relatorio-diario?envio=ok";
  if (!numero) {
    destino = `/admin/relatorio-diario?envio=erro&msg=${encodeURIComponent("WHATSAPP_RELATORIO_DESTINATARIOS vazia no Vercel")}`;
  } else {
    const resultado = await enviarModeloWhatsApp(numero, MODELO_WHATSAPP, parametrosModelo(await montarRelatorioDiario()));
    if (!resultado.ok) destino = `/admin/relatorio-diario?envio=erro&msg=${encodeURIComponent(resultado.erro)}`;
  }
  redirect(destino);
}
