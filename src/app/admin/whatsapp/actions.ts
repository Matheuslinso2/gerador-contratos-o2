"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isMatheus } from "@/lib/admin";
import { somenteDigitos } from "@/lib/whatsappContatos";

// Cadastro dos contatos da EQUIPE O2 no WhatsApp (ver
// lib/whatsappContatos.ts). Só o Matheus edita: quem entra aqui passa a ver
// o Workspace inteiro pelo WhatsApp. Contato de imobiliária NÃO é cadastrado
// aqui -- fica só no cadastro da própria imobiliária (pedido do Matheus,
// 08/10/2026; ver adicionarWhatsappImobiliaria em admin/imobiliarias).

async function exigirMatheus(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) redirect("/");
  return user!.email!;
}

function voltar(param: "erro" | "sucesso", msg: string): never {
  redirect(`/admin/whatsapp?${param}=${encodeURIComponent(msg)}`);
}

export async function adicionarContato(formData: FormData) {
  const email = await exigirMatheus();
  const numero = somenteDigitos(String(formData.get("numero") ?? ""));
  const nome = String(formData.get("nome") ?? "").trim();
  const recebeRelatorio = formData.get("recebe_relatorio") === "on";

  // DDI 55 + DDD + número: 12 (fixo) ou 13 (celular) dígitos.
  if (!/^55\d{10,11}$/.test(numero)) voltar("erro", "Número inválido: use 55 + DDD + número, ex: 5521999990000.");
  if (!nome) voltar("erro", "Informe o nome.");

  const { error } = await createServiceClient()
    .from("whatsapp_contatos")
    .insert({
      numero,
      nome,
      tipo: "equipe",
      recebe_relatorio: recebeRelatorio,
      criado_por_email: email,
    });
  if (error) voltar("erro", error.code === "23505" ? "Esse número já está cadastrado (na equipe ou em alguma imobiliária)." : error.message);
  revalidatePath("/admin/whatsapp");
  voltar("sucesso", `${nome} cadastrado.`);
}

export async function alternarCampo(formData: FormData) {
  await exigirMatheus();
  const id = String(formData.get("id") ?? "");
  const campo = String(formData.get("campo") ?? "");
  const valor = formData.get("valor") === "true";
  if (!id || !["ativo", "recebe_relatorio"].includes(campo)) voltar("erro", "Ação inválida.");

  const service = createServiceClient();
  if (campo === "recebe_relatorio" && valor) {
    const { data } = await service.from("whatsapp_contatos").select("tipo").eq("id", id).maybeSingle();
    if (data?.tipo === "imobiliaria") voltar("erro", "Só a equipe pode receber o relatório das 8h.");
  }
  const { error } = await service.from("whatsapp_contatos").update({ [campo]: valor }).eq("id", id).eq("tipo", "equipe");
  if (error) voltar("erro", error.message);
  revalidatePath("/admin/whatsapp");
  voltar("sucesso", "Atualizado.");
}

export async function excluirContato(formData: FormData) {
  await exigirMatheus();
  const id = String(formData.get("id") ?? "");
  const { error } = await createServiceClient().from("whatsapp_contatos").delete().eq("id", id).eq("tipo", "equipe");
  if (error) voltar("erro", error.message);
  revalidatePath("/admin/whatsapp");
  voltar("sucesso", "Contato removido.");
}
