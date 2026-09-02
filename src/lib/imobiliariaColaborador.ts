import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";

// CNPJ real da O2 Seguros -- todo colaborador/admin que usa Gerar
// Contrato/Auditor sem ser de uma imobiliária parceira cai nesse cadastro
// único, como se fosse "a imobiliária O2 Seguros" (decisão do Matheus,
// 2026-09-02: "todos da O2 Seguros ficam sob esse CNPJ, como se fosse uma
// imob"). Antes cada colaborador ganhava sua própria linha "O2 Seguros
// (uso interno)" -- 7 linhas duplicadas, consolidadas manualmente nessa
// mesma data.
const CNPJ_O2_SEGUROS = "20001784000180";

export async function garantirImobiliariaColaborador(
  supabase: SupabaseClient,
  userId: string,
  email: string | null | undefined
) {
  const existente = await buscarImobiliariaDoUsuario(supabase, { id: userId, email });
  if (existente) return existente;

  // .limit(1) em vez de .maybeSingle() -- se por algum motivo existir mais
  // de uma linha com esse CNPJ, .maybeSingle() erra e o catch acabava
  // criando OUTRA linha nova (foi exatamente assim que uma duplicata real
  // apareceu num teste, 2026-09-02). Com .limit(1) sempre reaproveita uma
  // existente em vez de piorar a duplicidade.
  const { data: cadastrosO2 } = await supabase.from("imobiliarias").select("id, nome").eq("cnpj", CNPJ_O2_SEGUROS).limit(1);
  const cadastroO2 = cadastrosO2?.[0] ?? null;
  if (cadastroO2) {
    if (email) {
      // Ignora erro de e-mail já existente (corrida rara entre duas abas) --
      // o que importa é que, ao final, essa pessoa tem acesso.
      await supabase.from("imobiliaria_membros").insert({ imobiliaria_id: cadastroO2.id, email });
    }
    return cadastroO2;
  }

  const { data: nova } = await supabase
    .from("imobiliarias")
    .insert({
      user_id: userId,
      email: email ?? null,
      nome: "O2 Seguros",
      cnpj: CNPJ_O2_SEGUROS,
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
