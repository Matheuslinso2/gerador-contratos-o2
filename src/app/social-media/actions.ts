"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { coletarNoticias } from "@/lib/social/news";
import { gerarConteudoDeNoticia, gerarConteudoInstitucional } from "@/lib/social/gerarConteudo";
import { publicarPost } from "@/lib/instagram";

async function exigirAcessoInterno() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(isAdmin(user.email) || isColaboradorO2(user.email))) redirect("/login");
  return supabase;
}

// Mesmo pipeline do cron (src/app/api/cron/coletar-noticias/route.ts), só
// que disparado manualmente pela página — útil pra testar sem esperar o
// horário do cron. Resume o resultado por fonte na URL (ver page.tsx) pra
// dar pra ver na hora se algum feed quebrou, sem precisar olhar log.
export async function coletarAgora() {
  await exigirAcessoInterno();
  const resultados = await coletarNoticias();
  const resumo = resultados
    .map((r) => `${r.fonte}: ${r.erro ? `erro (${r.erro})` : `${r.novas} novas`}`)
    .join(";;");
  revalidatePath("/social-media");
  redirect(`/social-media?coleta=${encodeURIComponent(resumo)}`);
}

// Gera um rascunho de post a partir de uma notícia coletada e marca a
// notícia como "usada" (não impede gerar de novo depois se quiser descartar
// o rascunho, só evita que ela continue aparecendo como pendente).
export async function gerarRascunho(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const noticiaId = Number(formData.get("noticia_id"));
  if (!noticiaId) return;

  const { data: noticia, error } = await supabase
    .from("social_media_noticias")
    .select("titulo, resumo, link, social_media_fontes(nome, categoria)")
    .eq("id", noticiaId)
    .single();
  if (error || !noticia) return;

  const fonte = noticia.social_media_fontes as unknown as { nome: string; categoria: string } | null;

  const conteudo = await gerarConteudoDeNoticia({
    titulo: noticia.titulo,
    resumo: noticia.resumo,
    link: noticia.link,
    fonteNome: fonte?.nome ?? "fonte desconhecida",
  });

  await supabase.from("social_media_posts").insert({
    noticia_id: noticiaId,
    categoria: fonte?.categoria ?? "mercado_imobiliario",
    titulo_card: conteudo.titulo_card,
    legenda: conteudo.legenda,
    tipo_post: conteudo.tipo_post,
    numero_destaque: conteudo.numero_destaque,
  });
  await supabase.from("social_media_noticias").update({ usado: true }).eq("id", noticiaId);

  revalidatePath("/social-media");
}

// Post institucional livre — sem notícia de origem, só um tema digitado.
export async function gerarRascunhoInstitucional(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const tema = String(formData.get("tema") ?? "").trim();
  if (!tema) return;

  const conteudo = await gerarConteudoInstitucional(tema);

  await supabase.from("social_media_posts").insert({
    tema_institucional: tema,
    categoria: "institucional",
    titulo_card: conteudo.titulo_card,
    legenda: conteudo.legenda,
    tipo_post: conteudo.tipo_post,
    numero_destaque: conteudo.numero_destaque,
  });

  revalidatePath("/social-media");
}

// Publica de verdade no Instagram — só roda quando você clica, nunca
// sozinho (ver plano da Fase 3/4: automação total fica pausada até você
// pedir). Guarda o resultado (sucesso ou erro) no próprio post.
export async function aprovarEPublicar(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    await supabase
      .from("social_media_posts")
      .update({ status: "erro", erro: "NEXT_PUBLIC_SITE_URL não configurada no Vercel" })
      .eq("id", postId);
    revalidatePath("/social-media");
    return;
  }

  const { data: post } = await supabase.from("social_media_posts").select("legenda").eq("id", postId).single();
  if (!post) return;

  try {
    const imageUrl = `${siteUrl}/api/social/imagem/${postId}`;
    const instagramPostId = await publicarPost(imageUrl, post.legenda);
    await supabase
      .from("social_media_posts")
      .update({ status: "publicado", publicado_em: new Date().toISOString(), instagram_post_id: instagramPostId, erro: null })
      .eq("id", postId);
  } catch (erro) {
    await supabase
      .from("social_media_posts")
      .update({ status: "erro", erro: erro instanceof Error ? erro.message : String(erro) })
      .eq("id", postId);
  }

  revalidatePath("/social-media");
}

// Descarta um rascunho que não ficou bom.
export async function descartarRascunho(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;
  await supabase.from("social_media_posts").delete().eq("id", postId);
  revalidatePath("/social-media");
}
