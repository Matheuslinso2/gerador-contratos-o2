import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParticipanteRow } from "./desempenho";
import { buscarEmLotes } from "@/lib/supabase/emLotes";

// Participantes da campanha para o quadro de metas (22/10/2026): as
// imobiliárias destinatárias, cada uma com sua linha -- a não ser que o
// grupo/rede dela esteja no modo "meta do grupo todo" (linha de meta com
// grupo_id em campanhas_metas), aí as unidades somam numa linha só.

type LinhaMeta = {
  id: string;
  imobiliaria_id: string | null;
  grupo_id: string | null;
  meta: number | null;
  custo_premiacao: number | null;
  observacao: string | null;
  responsavel_email: string | null;
};

export type GrupoNaCampanha = { grupoId: string; nome: string; unidades: number; modo: "grupo" | "filial" };

export async function participantesDaCampanha(
  db: SupabaseClient,
  campanhaId: string,
  idsImobiliarias: string[]
): Promise<{ participantes: ParticipanteRow[]; grupos: GrupoNaCampanha[] }> {
  const [{ data: metasData }, imobsData] = await Promise.all([
    db.from("campanhas_metas").select("id, imobiliaria_id, grupo_id, meta, custo_premiacao, observacao, responsavel_email").eq("campanha_id", campanhaId),
    buscarEmLotes<{ id: string; grupo_id: string | null }>(idsImobiliarias, (lote) => db.from("imobiliarias").select("id, grupo_id").in("id", lote)),
  ]);
  const metas = (metasData ?? []) as LinhaMeta[];
  const imobs = imobsData;
  const gruposEmModoGrupo = new Set(metas.filter((m) => m.grupo_id).map((m) => m.grupo_id as string));

  const linha = (m: LinhaMeta | undefined, base: Pick<ParticipanteRow, "id" | "imobiliaria_id" | "grupo_id">): ParticipanteRow => ({
    ...base,
    meta: m?.meta === null || m?.meta === undefined ? null : Number(m.meta),
    custo_premiacao: Number(m?.custo_premiacao) || 0,
    observacao: m?.observacao ?? null,
    responsavel_email: m?.responsavel_email ?? null,
  });

  const participantes: ParticipanteRow[] = [];
  for (const m of metas.filter((x) => x.grupo_id)) participantes.push(linha(m, { id: m.id, imobiliaria_id: null, grupo_id: m.grupo_id }));
  for (const imob of imobs) {
    if (imob.grupo_id && gruposEmModoGrupo.has(imob.grupo_id)) continue;
    const m = metas.find((x) => x.imobiliaria_id === imob.id);
    participantes.push(linha(m, { id: m?.id ?? `imob:${imob.id}`, imobiliaria_id: imob.id, grupo_id: null }));
  }

  // Grupos que têm unidade na campanha (pra escolher o modo de meta).
  const contagem = new Map<string, number>();
  for (const i of imobs) if (i.grupo_id) contagem.set(i.grupo_id, (contagem.get(i.grupo_id) ?? 0) + 1);
  for (const g of gruposEmModoGrupo) if (!contagem.has(g)) contagem.set(g, 0);
  const idsGrupos = [...contagem.keys()];
  const { data: nomes } = idsGrupos.length ? await db.from("imobiliaria_grupos").select("id, nome").in("id", idsGrupos) : { data: [] };
  const grupos: GrupoNaCampanha[] = ((nomes ?? []) as { id: string; nome: string }[])
    .map((g) => ({ grupoId: g.id, nome: g.nome, unidades: contagem.get(g.id) ?? 0, modo: gruposEmModoGrupo.has(g.id) ? ("grupo" as const) : ("filial" as const) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return { participantes, grupos };
}
