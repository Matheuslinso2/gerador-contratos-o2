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
export async function buscarImobiliariaDoUsuario(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null } | null | undefined
) {
  if (!user) return null;

  const { data: comoTitular } = await supabase.from("imobiliarias").select("*").eq("user_id", user.id).maybeSingle();
  if (comoTitular) return comoTitular;

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
  return comoMembro;
}
