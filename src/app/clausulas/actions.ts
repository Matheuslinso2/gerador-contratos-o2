"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

async function clienteAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) throw new Error("Acesso restrito ao administrador.");
  return supabase;
}

export async function addSeguradora(formData: FormData) {
  const supabase = await clienteAdmin();
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return;

  const { error } = await supabase.from("seguradoras").insert({ nome });
  if (error) throw new Error(error.message);

  revalidatePath("/clausulas");
}

export async function addProduto(formData: FormData) {
  const supabase = await clienteAdmin();
  const seguradora_id = String(formData.get("seguradora_id") ?? "");
  const tipo_garantia_id = String(formData.get("tipo_garantia_id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const clausula_base = String(formData.get("clausula_base") ?? "").trim();
  if (!seguradora_id || !tipo_garantia_id || !nome || !clausula_base) return;

  const { error } = await supabase
    .from("produtos")
    .insert({ seguradora_id, tipo_garantia_id, nome, clausula_base });
  if (error) throw new Error(error.message);

  revalidatePath("/clausulas");
}

export async function addCobertura(formData: FormData) {
  const supabase = await clienteAdmin();
  const produto_id = String(formData.get("produto_id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const texto = String(formData.get("texto") ?? "").trim();
  if (!produto_id || !nome || !texto) return;

  const { error } = await supabase
    .from("coberturas_adicionais")
    .insert({ produto_id, nome, texto });
  if (error) throw new Error(error.message);

  revalidatePath("/clausulas");
}
