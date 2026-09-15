"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

export async function criarCampanha(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const nome = String(formData.get("nome") ?? "").trim();
  const assunto = String(formData.get("assunto") ?? "").trim();
  const template = String(formData.get("template") ?? "comunicado");
  const titulo = String(formData.get("titulo") ?? "").trim();
  const introducao = String(formData.get("introducao") ?? "").trim();
  const validoDe = String(formData.get("valido_de") ?? "").trim();
  const validoAte = String(formData.get("valido_ate") ?? "").trim();
  const produto = String(formData.get("produto") ?? "").trim();
  const corpoHtml = String(formData.get("corpo_html") ?? "").trim();
  const ctaTexto = String(formData.get("cta_texto") ?? "").trim();
  const ctaHref = String(formData.get("cta_href") ?? "").trim();

  // corpo_html vem do editor com formatação (EditorCorpo) já reembrulhado em
  // <tr><td> -- checa se sobra texto de verdade removendo as tags antes de
  // validar (uma imagem sozinha sem nenhum texto também conta como corpo
  // preenchido).
  const temConteudo = corpoHtml.replace(/<[^>]+>/g, "").trim().length > 0 || /<img[\s>]/i.test(corpoHtml);
  if (!nome || !assunto || !titulo || !temConteudo || !produto) {
    redirect(`/campanhas/nova?erro=${encodeURIComponent("Preencha nome, produto, assunto, título e corpo da campanha.")}`);
  }
  if (validoDe && validoAte && validoDe > validoAte) {
    redirect(`/campanhas/nova?erro=${encodeURIComponent("A data \"válido de\" não pode ser depois de \"válido até\".")}`);
  }

  const { data: campanha, error } = await supabase
    .from("campanhas")
    .insert({
      nome,
      assunto,
      template,
      titulo,
      introducao: introducao || null,
      valido_de: validoDe || null,
      valido_ate: validoAte || null,
      produto,
      corpo_html: corpoHtml,
      cta_texto: ctaTexto || null,
      cta_href: ctaHref || null,
      criado_por: user.id,
      criado_por_email: user.email,
    })
    .select("id")
    .single();

  if (error || !campanha) {
    redirect(`/campanhas/nova?erro=${encodeURIComponent(error?.message ?? "Falha ao criar a campanha.")}`);
  }

  redirect(`/campanhas/${campanha.id}/destinatarios`);
}
