import type { SupabaseClient } from "@supabase/supabase-js";

// Pedido do Matheus, 17/09/2026: dar a opção de incluir a equipe da O2 (e o
// e-mail comercial@) como destinatário de uma campanha comercial normal --
// reaproveita a mesma lista de e-mails já cadastrada pra Avisos Internos
// (avisos_internos_grupos, ver /campanhas/avisos-internos) em vez de manter
// uma segunda lista de funcionários duplicada.
export const EMAIL_COMERCIAL_O2 = "comercial@o2seguros.com.br";

export async function buscarEmailsEquipeInterna(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("avisos_internos_grupos").select("emails");
  const emails = new Set<string>();
  for (const grupo of data ?? []) {
    for (const email of (grupo.emails as string[] | null) ?? []) {
      const normalizado = email.trim().toLowerCase();
      if (normalizado) emails.add(normalizado);
    }
  }
  emails.add(EMAIL_COMERCIAL_O2);
  return [...emails];
}
