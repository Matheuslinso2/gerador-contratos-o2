"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// Item B da reunião de 15/09/2026, esclarecido pelo Matheus depois: não
// era bug, era pedido de manutenção -- quando entra/sai gente da O2, a
// Jéssica precisa atualizar a lista de e-mails que recebe "Avisos
// internos" sem precisar me pedir pra mexer direto no banco (única forma
// que existia até aqui, ver avisos_internos_grupos_seed).
const EMAIL_O2_REGEX = /^[^\s@]+@o2seguros\.com\.br$/i;

export async function adicionarEmailAvisoInterno(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const grupoId = String(formData.get("grupo_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!EMAIL_O2_REGEX.test(email)) {
    redirect(`/campanhas/avisos-internos/equipe?erro=${encodeURIComponent("Use um e-mail @o2seguros.com.br.")}`);
  }

  const { data: grupo } = await supabase.from("avisos_internos_grupos").select("emails").eq("id", grupoId).single();
  if (!grupo) redirect("/campanhas/avisos-internos/equipe");

  const emails = new Set<string>((grupo.emails as string[] | null) ?? []);
  emails.add(email);

  const { error } = await supabase
    .from("avisos_internos_grupos")
    .update({ emails: [...emails], atualizado_em: new Date().toISOString() })
    .eq("id", grupoId);
  if (error) redirect(`/campanhas/avisos-internos/equipe?erro=${encodeURIComponent(error.message)}`);

  redirect(`/campanhas/avisos-internos/equipe?ok=${encodeURIComponent(`${email} adicionado.`)}`);
}

export async function removerEmailAvisoInterno(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const grupoId = String(formData.get("grupo_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  const { data: grupo } = await supabase.from("avisos_internos_grupos").select("emails").eq("id", grupoId).single();
  if (!grupo) redirect("/campanhas/avisos-internos/equipe");

  const emails = ((grupo.emails as string[] | null) ?? []).filter((e) => e.toLowerCase() !== email);

  const { error } = await supabase
    .from("avisos_internos_grupos")
    .update({ emails, atualizado_em: new Date().toISOString() })
    .eq("id", grupoId);
  if (error) redirect(`/campanhas/avisos-internos/equipe?erro=${encodeURIComponent(error.message)}`);

  redirect(`/campanhas/avisos-internos/equipe?ok=${encodeURIComponent(`${email} removido.`)}`);
}
