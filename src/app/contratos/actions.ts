"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";

async function minhaImobiliariaId(
  user: { id: string; email?: string | null },
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const imobiliaria = await buscarImobiliariaDoUsuario(supabase, user);
  return imobiliaria?.id ?? null;
}

export async function excluirContrato(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const imobiliariaId = await minhaImobiliariaId(user, supabase);
  if (!imobiliariaId) redirect("/contratos");

  const { data: contrato } = await supabase
    .from("contratos")
    .select("id, imobiliaria_id, laudo_arquivo_path")
    .eq("id", id)
    .single();

  if (!contrato || contrato.imobiliaria_id !== imobiliariaId) {
    redirect(`/contratos?erro=${encodeURIComponent("Contrato não encontrado.")}`);
  }

  if (contrato.laudo_arquivo_path) {
    await supabase.storage.from("laudos").remove([contrato.laudo_arquivo_path]);
  }

  const { error } = await supabase.from("contratos").delete().eq("id", id);
  if (error) redirect(`/contratos?erro=${encodeURIComponent(error.message)}`);

  revalidatePath("/contratos");
  redirect("/contratos?excluido=1");
}

export async function excluirAuditoria(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const imobiliariaId = await minhaImobiliariaId(user, supabase);
  if (!imobiliariaId) redirect("/contratos");

  const { data: auditoria } = await supabase
    .from("auditorias_contrato")
    .select("id, imobiliaria_id")
    .eq("id", id)
    .single();

  if (!auditoria || auditoria.imobiliaria_id !== imobiliariaId) {
    redirect(`/contratos?erro=${encodeURIComponent("Auditoria não encontrada.")}`);
  }

  const { error } = await supabase.from("auditorias_contrato").delete().eq("id", id);
  if (error) redirect(`/contratos?erro=${encodeURIComponent(error.message)}`);

  revalidatePath("/contratos");
  redirect("/contratos?excluido=1");
}
