import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarMetricasMidias, normalizarPermalink } from "@/lib/instagram";

// Compartilhada entre o botão "Atualizar métricas" do dashboard (sessão do
// usuário) e o cron diário (service role) -- mesmo padrão de publicar.ts.
// Só olha posts publicados que têm permalink guardado (os antigos que
// caíram no fallback do ID puro não dão pra casar com a listagem da API).
export async function atualizarMetricasPosts(
  supabase: SupabaseClient
): Promise<{ ok: true; atualizados: number; semInsights: boolean } | { ok: false; erro: string }> {
  try {
    const { data: posts, error } = await supabase
      .from("social_media_posts")
      .select("id, instagram_post_id")
      .eq("status", "publicado")
      .like("instagram_post_id", "http%");
    if (error) throw new Error(error.message);
    if (!posts?.length) return { ok: true, atualizados: 0, semInsights: false };

    const midias = await buscarMetricasMidias(50);

    let atualizados = 0;
    let semInsights = false;
    const agora = new Date().toISOString();
    for (const post of posts) {
      const metricas = midias.get(normalizarPermalink(post.instagram_post_id));
      if (!metricas) continue;
      if (metricas.alcance === null) semInsights = true;
      await supabase.from("social_media_posts").update({ metricas, metricas_atualizadas_em: agora }).eq("id", post.id);
      atualizados++;
    }
    return { ok: true, atualizados, semInsights };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
