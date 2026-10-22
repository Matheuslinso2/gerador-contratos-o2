import type { SupabaseClient } from "@supabase/supabase-js";

// Uma ficha pode ter mais de um produtor no Corp (ex.: Dreher — 327 e 356).
// `imobiliarias.codigo_produtor_corp` guarda só o principal; todos os códigos
// vêm da visão `imobiliaria_codigos_corp` (registros de fonte corp_produtor
// + o código principal). Ver supabase/schema_codigos_corp_ficha.sql.
export type CodigoCorp = {
  imobiliaria_id: string;
  codigo: string;
  nome_corp: string | null;
  cpf_cnpj: string | null;
  principal: boolean;
};

export async function buscarCodigosCorp(db: SupabaseClient, ids?: string[]): Promise<Map<string, CodigoCorp[]>> {
  const porFicha = new Map<string, CodigoCorp[]>();
  if (ids && !ids.length) return porFicha;
  const LOTE = ids ? 300 : Infinity;
  const lotes = ids ? Array.from({ length: Math.ceil(ids.length / LOTE) }, (_, n) => ids.slice(n * LOTE, (n + 1) * LOTE)) : [null];
  for (const lote of lotes) {
    for (let de = 0; ; de += 1000) {
      let q = db.from("imobiliaria_codigos_corp").select("imobiliaria_id, codigo, nome_corp, cpf_cnpj, principal").range(de, de + 999);
      if (lote) q = q.in("imobiliaria_id", lote);
      const { data, error } = await q;
      if (error) throw new Error(`códigos do Corp: ${error.message}`);
      for (const c of (data ?? []) as CodigoCorp[]) {
        const lista = porFicha.get(c.imobiliaria_id) ?? [];
        lista.push(c);
        porFicha.set(c.imobiliaria_id, lista);
      }
      if (!data || data.length < 1000) break;
    }
  }
  for (const lista of porFicha.values()) lista.sort((a, b) => Number(b.principal) - Number(a.principal) || Number(a.codigo) - Number(b.codigo));
  return porFicha;
}
