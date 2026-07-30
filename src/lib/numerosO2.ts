import { createClient } from "@/lib/supabase/server";

export type NumerosO2 = {
  total_contratos: number;
  total_imobiliarias_parceiras: number;
  total_seguradoras_parceiras: number;
  total_produtos_ativos: number;
  contratos_ultimos_12_meses: number;
};

// Números reais da própria operação deste sistema, usados como prova social
// no relatório de prospecção. Refletem só o que passa por este app (não o
// volume total de negócios da O2 como corretora).
export async function obterNumerosO2(): Promise<NumerosO2> {
  const supabase = await createClient();

  const doze_meses_atras = new Date();
  doze_meses_atras.setMonth(doze_meses_atras.getMonth() - 12);

  const [
    { count: total_contratos },
    { count: total_imobiliarias_parceiras },
    { count: total_seguradoras_parceiras },
    { count: total_produtos_ativos },
    { count: contratos_ultimos_12_meses },
  ] = await Promise.all([
    supabase.from("contratos").select("*", { count: "exact", head: true }),
    supabase.from("imobiliarias").select("*", { count: "exact", head: true }),
    supabase.from("seguradoras").select("*", { count: "exact", head: true }),
    supabase.from("produtos").select("*", { count: "exact", head: true }),
    supabase
      .from("contratos")
      .select("*", { count: "exact", head: true })
      .gte("created_at", doze_meses_atras.toISOString()),
  ]);

  return {
    total_contratos: total_contratos ?? 0,
    total_imobiliarias_parceiras: total_imobiliarias_parceiras ?? 0,
    total_seguradoras_parceiras: total_seguradoras_parceiras ?? 0,
    total_produtos_ativos: total_produtos_ativos ?? 0,
    contratos_ultimos_12_meses: contratos_ultimos_12_meses ?? 0,
  };
}
