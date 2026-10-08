"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isMatheus } from "@/lib/admin";
import { montarRelatorioDiario, parametrosModelo, MODELO_WHATSAPP } from "@/lib/relatorioDiario/montar";
import { enviarModeloWhatsApp } from "@/lib/whatsapp";
import { destinatariosDoRelatorio } from "@/lib/whatsappContatos";

// Envia o relatório de agora SÓ pro primeiro número da lista (o do
// Matheus), pra testar o modelo aprovado antes de ligar pra todos.
export async function enviarTesteWhatsApp() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) redirect("/");

  const [numero] = await destinatariosDoRelatorio();
  let destino = "/admin/relatorio-diario?envio=ok";
  if (!numero) {
    destino = `/admin/relatorio-diario?envio=erro&msg=${encodeURIComponent("nenhum contato da equipe marcado pra receber o relatório (Configurações → WhatsApp)")}`;
  } else {
    const resultado = await enviarModeloWhatsApp(numero, MODELO_WHATSAPP, parametrosModelo(await montarRelatorioDiario()));
    if (!resultado.ok) destino = `/admin/relatorio-diario?envio=erro&msg=${encodeURIComponent(resultado.erro)}`;
  }
  redirect(destino);
}

// Mesmo envio do cron das 8h, disparado à mão (pedido do Matheus em
// 06/10/2026, pra mandar o primeiro relatório aos sócios no mesmo dia).
export async function enviarParaTodosWhatsApp() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) redirect("/");

  const destinatarios = await destinatariosDoRelatorio();
  if (destinatarios.length === 0) {
    redirect(`/admin/relatorio-diario?envio=erro&msg=${encodeURIComponent("nenhum contato da equipe marcado pra receber o relatório (Configurações → WhatsApp)")}`);
  }
  const parametros = parametrosModelo(await montarRelatorioDiario());
  const falhas: string[] = [];
  for (const numero of destinatarios) {
    const r = await enviarModeloWhatsApp(numero, MODELO_WHATSAPP, parametros);
    if (!r.ok) falhas.push(`…${numero.slice(-4)}: ${r.erro}`);
  }
  const enviados = destinatarios.length - falhas.length;
  redirect(
    falhas.length
      ? `/admin/relatorio-diario?envio=erro&msg=${encodeURIComponent(`${enviados} de ${destinatarios.length} enviados. Falharam: ${falhas.join(" | ")}`)}`
      : `/admin/relatorio-diario?envio=todos&msg=${destinatarios.length}`
  );
}
