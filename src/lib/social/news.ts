import Parser from "rss-parser";
import { createServiceClient } from "@/lib/supabase/service";

const parser = new Parser({ timeout: 15000 });

export type FonteNoticia = {
  id: number;
  nome: string;
  url_rss: string;
  categoria: "mercado_imobiliario" | "seguro_imobiliario";
  ativo: boolean;
};

export type ResultadoColeta = {
  fonte: string;
  novas: number;
  erro?: string;
};

// Busca todas as fontes ativas, faz parse de cada feed RSS e grava as
// notícias novas (por link, que é unique). Uma fonte com feed quebrado não
// derruba a coleta das outras — cada uma roda isolada em try/catch.
export async function coletarNoticias(): Promise<ResultadoColeta[]> {
  const supabase = createServiceClient();

  const { data: fontes, error: erroFontes } = await supabase
    .from("social_media_fontes")
    .select("id, nome, url_rss, categoria, ativo")
    .eq("ativo", true);
  if (erroFontes) throw new Error(`Falha ao listar fontes: ${erroFontes.message}`);

  const resultados: ResultadoColeta[] = [];

  for (const fonte of (fontes ?? []) as FonteNoticia[]) {
    try {
      const feed = await parser.parseURL(fonte.url_rss);
      const linhas = (feed.items ?? [])
        .filter((item) => item.link && item.title)
        .map((item) => ({
          fonte_id: fonte.id,
          titulo: item.title!.trim(),
          link: item.link!.trim(),
          resumo: (item.contentSnippet ?? item.summary ?? "").trim().slice(0, 500) || null,
          publicado_em: item.isoDate ?? item.pubDate ?? null,
        }));

      if (!linhas.length) {
        resultados.push({ fonte: fonte.nome, novas: 0 });
        continue;
      }

      const { data: inseridas, error: erroInsert } = await supabase
        .from("social_media_noticias")
        .upsert(linhas, { onConflict: "link", ignoreDuplicates: true })
        .select("id");
      if (erroInsert) throw erroInsert;

      resultados.push({ fonte: fonte.nome, novas: inseridas?.length ?? 0 });
    } catch (erro) {
      resultados.push({
        fonte: fonte.nome,
        novas: 0,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  return resultados;
}
