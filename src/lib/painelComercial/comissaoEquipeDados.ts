import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenciaWS } from "./comissaoEquipe";

// Dados do Workspace para a comissão da equipe (06/11/2026): vínculo empresa do Bitrix -> imobiliária (só confirmados, base única),
// cotações/efetivações da produção unificada (a mesma função do funil das Campanhas) e imobiliárias da campanha Elite.

const emLotes = <T,>(lista: T[], n: number) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));

export async function vinculosEmpresaImobiliaria(db: SupabaseClient, empresaIds: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (const lote of emLotes([...new Set(empresaIds)].filter(Boolean), 200)) {
    const { data } = await db.from("imobiliaria_registros_fonte").select("imobiliaria_id, chave_externa").eq("fonte", "bitrix_empresa").eq("situacao", "confirmado").in("chave_externa", lote);
    for (const r of (data ?? []) as { imobiliaria_id: string | null; chave_externa: string }[]) if (r.imobiliaria_id) mapa.set(String(r.chave_externa), r.imobiliaria_id);
  }
  return mapa;
}

export async function nomesImobiliarias(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (const lote of emLotes([...new Set(ids)], 200)) {
    const { data } = await db.from("imobiliarias").select("id, nome").in("id", lote);
    for (const r of (data ?? []) as { id: string; nome: string }[]) mapa.set(r.id, r.nome);
  }
  return mapa;
}

export async function evidenciasWorkspace(db: SupabaseClient, imobs: string[], desde: string): Promise<EvidenciaWS[]> {
  const saida: EvidenciaWS[] = [];
  for (const lote of emLotes([...new Set(imobs)], 100)) {
    const { data, error } = await db.rpc("campanha_programa_funil", { p_imobs: lote, p_produtos: ["fianca", "re", "capitalizacao"], p_desde: desde });
    if (error) throw new Error(`Evidência do Workspace indisponível: ${error.message}`);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      saida.push({
        id: String(r.id),
        chave: (r.chave_caso as string | null) ?? null,
        imobiliariaId: String(r.imobiliaria_id),
        produto: String(r.produto),
        tipo: String(r.tipo ?? ""),
        status: String(r.status_padrao ?? ""),
        dataCotacao: (r.data_recebimento as string | null) ?? null,
        dataEfetivacao: (r.data_efetivacao as string | null) ?? null,
        comissao: r.comissao === null || r.comissao === undefined ? null : Number(r.comissao),
        origemBitrixId: (r.origem_bitrix_id as string | null) ?? null,
        fonte: String(r.fonte ?? ""),
      });
    }
  }
  return saida;
}

/** Imobiliárias da(s) campanha(s) Elite com meta cadastrada (inclui as unidades dos grupos em modo "grupo"): Fiança e Capitalização delas seguem a regra de crescimento. */
export async function imobiliariasDaElite(db: SupabaseClient): Promise<Set<string>> {
  const { data: campanhas } = await db.from("campanhas").select("id").ilike("nome", "%elite%").is("campanha_pai_id", null).is("arquivada_em", null);
  const ids = new Set<string>();
  for (const c of (campanhas ?? []) as { id: string }[]) {
    const { data: metas } = await db.from("campanhas_metas").select("imobiliaria_id, grupo_id, meta").eq("campanha_id", c.id).gt("meta", 0);
    const grupos: string[] = [];
    for (const m of (metas ?? []) as { imobiliaria_id: string | null; grupo_id: string | null }[]) {
      if (m.imobiliaria_id) ids.add(m.imobiliaria_id);
      if (m.grupo_id) grupos.push(m.grupo_id);
    }
    if (grupos.length) {
      const { data: membros } = await db.from("imobiliarias").select("id").in("grupo_id", grupos);
      for (const i of (membros ?? []) as { id: string }[]) ids.add(i.id);
    }
  }
  return ids;
}
