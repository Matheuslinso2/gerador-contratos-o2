import type { SupabaseClient } from "@supabase/supabase-js";

// Colaboradores/admin da O2 podem usar Gerar Contrato e Auditor sem passar
// pelo cadastro completo de imobiliária parceira — o sistema garante um
// registro simples pra eles na primeira vez que precisarem de um
// imobiliaria_id (contratos/auditorias exigem esse vínculo).
export async function garantirImobiliariaColaborador(
  supabase: SupabaseClient,
  userId: string,
  email: string | null | undefined
) {
  const { data: existente } = await supabase
    .from("imobiliarias")
    .select("id, nome")
    .eq("user_id", userId)
    .maybeSingle();
  if (existente) return existente;

  const { data: nova } = await supabase
    .from("imobiliarias")
    .insert({
      user_id: userId,
      email: email ?? null,
      nome: "O2 Seguros (uso interno)",
      cnpj: "A definir",
      indice_reajuste: "IGPM",
      texto_base_contrato: "Texto-base a definir em /imobiliaria.",
      percentual_multa_atraso: 10,
      percentual_juros_mora: 1,
      percentual_honorarios_advocaticios: 20,
    })
    .select("id, nome")
    .single();

  return nova;
}
