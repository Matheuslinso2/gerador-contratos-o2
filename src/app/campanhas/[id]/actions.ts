"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// Pedido da reunião de 15/09/2026: relançar uma campanha parecida sem
// reescrever tudo do zero. Copia só o conteúdo e a seleção de
// destinatários -- nunca o histórico de envio/produção, que é específico
// do disparo original.
export async function duplicarCampanha(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");

  const { data: original } = await supabase
    .from("campanhas")
    .select("nome, assunto, template, titulo, introducao, valido_de, valido_ate, produto, corpo_html, cta_texto, cta_href, imobiliarias_selecionadas")
    .eq("id", campanhaId)
    .single();
  if (!original) redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Campanha não encontrada.")}`);

  const { data: copia, error } = await supabase
    .from("campanhas")
    .insert({
      nome: `${original.nome} (cópia)`,
      assunto: original.assunto,
      template: original.template,
      titulo: original.titulo,
      introducao: original.introducao,
      valido_de: original.valido_de,
      valido_ate: original.valido_ate,
      produto: original.produto,
      corpo_html: original.corpo_html,
      cta_texto: original.cta_texto,
      cta_href: original.cta_href,
      imobiliarias_selecionadas: original.imobiliarias_selecionadas,
      status: "rascunho",
      criado_por: user.id,
      criado_por_email: user.email,
    })
    .select("id")
    .single();

  if (error || !copia) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent(error?.message ?? "Falha ao duplicar a campanha.")}`);
  }

  redirect(`/campanhas/${copia.id}`);
}
