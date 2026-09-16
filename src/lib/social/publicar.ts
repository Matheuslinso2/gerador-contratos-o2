import type { SupabaseClient } from "@supabase/supabase-js";
import { publicarPost } from "@/lib/instagram";

// Compartilhada entre o clique manual de "Aprovar e publicar"
// (src/app/social-media/actions.ts, sessão do usuário) e o cron que dispara
// publicações agendadas com a hora vencida
// (src/app/api/cron/publicar-social-media/route.ts, service role) -- mesmo
// padrão de src/lib/campanhas/dispararCampanha.ts. Recebe o client já
// pronto porque cada chamador autentica de um jeito diferente.
export async function publicarPostPorId(
  supabase: SupabaseClient,
  postId: number
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    const erro = "NEXT_PUBLIC_SITE_URL não configurada no Vercel";
    await supabase.from("social_media_posts").update({ status: "erro", erro }).eq("id", postId);
    return { ok: false, erro };
  }

  const { data: post } = await supabase.from("social_media_posts").select("legenda").eq("id", postId).single();
  if (!post) return { ok: false, erro: "Post não encontrado." };

  try {
    const imageUrl = `${siteUrl}/api/social/imagem/${postId}`;
    const instagramPostId = await publicarPost(imageUrl, post.legenda);
    await supabase
      .from("social_media_posts")
      .update({ status: "publicado", publicado_em: new Date().toISOString(), instagram_post_id: instagramPostId, erro: null })
      .eq("id", postId);
    return { ok: true };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await supabase.from("social_media_posts").update({ status: "erro", erro: mensagem }).eq("id", postId);
    return { ok: false, erro: mensagem };
  }
}
