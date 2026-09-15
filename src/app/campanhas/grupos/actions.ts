"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

export async function criarGrupo(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const nome = String(formData.get("nome") ?? "").trim();
  const imobiliariaIds = formData.getAll("imob").map(String).filter(Boolean);

  if (!nome) {
    redirect(`/campanhas/grupos/novo?erro=${encodeURIComponent("Dê um nome pro grupo.")}`);
  }

  const { data: grupo, error } = await supabase
    .from("campanhas_grupos")
    .insert({
      nome,
      imobiliaria_ids: imobiliariaIds,
      criado_por: user.id,
      criado_por_email: user.email,
    })
    .select("id")
    .single();

  if (error || !grupo) {
    const mensagem = error?.code === "23505" ? "Já existe um grupo com esse nome." : (error?.message ?? "Falha ao criar o grupo.");
    redirect(`/campanhas/grupos/novo?erro=${encodeURIComponent(mensagem)}`);
  }

  redirect("/campanhas/grupos");
}

export async function atualizarGrupo(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const grupoId = String(formData.get("grupo_id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const imobiliariaIds = formData.getAll("imob").map(String).filter(Boolean);

  if (!nome) {
    redirect(`/campanhas/grupos/${grupoId}?erro=${encodeURIComponent("Dê um nome pro grupo.")}`);
  }

  const { error } = await supabase
    .from("campanhas_grupos")
    .update({ nome, imobiliaria_ids: imobiliariaIds, updated_at: new Date().toISOString() })
    .eq("id", grupoId);

  if (error) {
    const mensagem = error.code === "23505" ? "Já existe um grupo com esse nome." : error.message;
    redirect(`/campanhas/grupos/${grupoId}?erro=${encodeURIComponent(mensagem)}`);
  }

  redirect(`/campanhas/grupos/${grupoId}?ok=${encodeURIComponent("Grupo atualizado.")}`);
}

export async function excluirGrupo(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const grupoId = String(formData.get("grupo_id") ?? "");
  await supabase.from("campanhas_grupos").delete().eq("id", grupoId);
  redirect("/campanhas/grupos");
}
