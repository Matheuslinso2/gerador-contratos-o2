import type { SupabaseClient } from "@supabase/supabase-js";

// Imobiliárias que fazem parte da campanha (22/10/2026): a seleção atual,
// quem de fato recebeu o e-mail e as destinatárias dos e-mails filhos
// (parciais, boas-vindas por imobiliária). É a lista de linhas do quadro de
// metas e produção.
export async function imobiliariasDaCampanha(
  db: SupabaseClient,
  campanha: { id: string; imobiliarias_selecionadas?: string[] | null }
): Promise<string[]> {
  const ids = new Set<string>((campanha.imobiliarias_selecionadas ?? []) as string[]);
  const { data: filhos } = await db.from("campanhas").select("id, imobiliarias_selecionadas").eq("campanha_pai_id", campanha.id);
  const idsCampanhas = [campanha.id, ...((filhos ?? []) as { id: string }[]).map((f) => f.id)];
  for (const f of (filhos ?? []) as { imobiliarias_selecionadas: string[] | null }[]) for (const i of f.imobiliarias_selecionadas ?? []) ids.add(i);
  for (let de = 0; ; de += 1000) {
    const { data } = await db
      .from("campanhas_envios")
      .select("imobiliaria_id")
      .in("campanha_id", idsCampanhas)
      .not("imobiliaria_id", "is", null)
      .range(de, de + 999);
    for (const e of (data ?? []) as { imobiliaria_id: string }[]) ids.add(e.imobiliaria_id);
    if (!data || data.length < 1000) break;
  }
  return [...ids];
}
