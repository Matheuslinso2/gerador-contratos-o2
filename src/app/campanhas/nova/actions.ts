"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { O2_CINZA_ESCURO, FONTE } from "@/lib/integracoes/emailO2";

// Corpo é um textarea de texto simples (não HTML) -- o Matheus não escreve
// código, então parágrafos separados por linha em branco viram <tr>/<td> no
// mesmo estilo de tabela usado no resto dos e-mails O2 (compatibilidade com
// cliente de e-mail exige table-based HTML, não <p> soltos).
function textoParaHtmlParagrafos(texto: string): string {
  return texto
    .split(/\n{2,}/)
    .map((paragrafo) => paragrafo.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<tr><td style="padding:6px 28px;font-size:14px;color:${O2_CINZA_ESCURO};font-family:${FONTE};line-height:1.6;">${p.replace(/\n/g, "<br/>")}</td></tr>`
    )
    .join("");
}

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
  const validoAte = String(formData.get("valido_ate") ?? "").trim();
  const corpo = String(formData.get("corpo") ?? "").trim();
  const ctaTexto = String(formData.get("cta_texto") ?? "").trim();
  const ctaHref = String(formData.get("cta_href") ?? "").trim();

  if (!nome || !assunto || !titulo || !corpo) {
    redirect(`/campanhas/nova?erro=${encodeURIComponent("Preencha nome, assunto, título e corpo da campanha.")}`);
  }

  const { data: campanha, error } = await supabase
    .from("campanhas")
    .insert({
      nome,
      assunto,
      template,
      titulo,
      introducao: introducao || null,
      valido_ate: validoAte || null,
      corpo_html: textoParaHtmlParagrafos(corpo),
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
