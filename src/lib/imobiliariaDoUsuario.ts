import type { SupabaseClient } from "@supabase/supabase-js";

// Resolve a imobiliária do usuário logado -- como titular (dono do
// cadastro, imobiliarias.user_id) ou como membro convidado (e-mail listado
// em imobiliaria_membros). Acesso completo nos dois casos, igual combinado
// com o Matheus: quem acessa por convite vê e edita tudo, igual ao titular.
//
// Cada caso é uma consulta separada (em vez de um único OR) porque um
// colaborador O2 enxerga TODAS as imobiliarias via RLS (leitura de
// suporte) -- filtrar direto por user_id evita que maybeSingle() quebre
// com "mais de uma linha" pra esse perfil.
// observacao_interna, classificacao_crm e responsavel_crm são de uso
// EXCLUSIVO da equipe O2 (nota interna, classificação/responsável do CRM
// vindos da lista de referência unificada em imobiliarias) -- nunca devem
// chegar no lado de quem loga como a própria imobiliária (titular ou
// membro convidado). Tira do resultado aqui, no único ponto de resolução
// usado por esse lado, em vez de confiar que cada tela que usa essa função
// nunca vai renderizar/expor o campo por engano.
type CamposInternosO2 = "observacao_interna" | "classificacao_crm" | "responsavel_crm";
function semCamposInternosO2<T extends Partial<Record<CamposInternosO2, unknown>>>(
  linha: T | null
): Omit<T, CamposInternosO2> | null {
  if (!linha) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descartados de propósito
  const { observacao_interna: _o, classificacao_crm: _c, responsavel_crm: _r, ...resto } = linha;
  return resto;
}

export async function buscarImobiliariaDoUsuario(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null } | null | undefined
) {
  if (!user) return null;

  const { data: comoTitular } = await supabase.from("imobiliarias").select("*").eq("user_id", user.id).maybeSingle();
  if (comoTitular) return semCamposInternosO2(comoTitular);

  if (!user.email) return null;
  const { data: membro } = await supabase
    .from("imobiliaria_membros")
    .select("imobiliaria_id")
    .eq("email", user.email)
    .maybeSingle();
  if (!membro) return null;

  const { data: comoMembro } = await supabase
    .from("imobiliarias")
    .select("*")
    .eq("id", membro.imobiliaria_id)
    .maybeSingle();
  return semCamposInternosO2(comoMembro);
}
