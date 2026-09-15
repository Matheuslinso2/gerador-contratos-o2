"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// Números vêm de <input type="number"> -- string vazia vira 0 (default da
// coluna), nunca null: o quadro soma essas colunas, e um null quebraria a
// soma ou exigiria checagem em todo lugar. "Preencheu 0 de propósito" e
// "não preencheu ainda" não precisam ser distinguíveis aqui.
function numeroOuZero(formData: FormData, campo: string): number {
  const bruto = String(formData.get(campo) ?? "").trim();
  const valor = Number(bruto);
  return bruto && Number.isFinite(valor) ? valor : 0;
}

export async function adicionarLinhaProducao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  if (!campanhaId || !imobiliariaId) {
    redirect(`/campanhas/${campanhaId}/producao?erro=${encodeURIComponent("Selecione uma imobiliária.")}`);
  }

  const { error } = await supabase.from("campanhas_producao").insert({
    campanha_id: campanhaId,
    imobiliaria_id: imobiliariaId,
    quantidade_apolices: numeroOuZero(formData, "quantidade_apolices"),
    premio_liquido: numeroOuZero(formData, "premio_liquido"),
    comissao_gerada: numeroOuZero(formData, "comissao_gerada"),
    repasse_gerado: numeroOuZero(formData, "repasse_gerado"),
    atualizado_por: user.id,
    atualizado_por_email: user.email,
  });

  if (error) {
    const mensagem = error.code === "23505" ? "Essa imobiliária já está no quadro." : error.message;
    redirect(`/campanhas/${campanhaId}/producao?erro=${encodeURIComponent(mensagem)}`);
  }

  revalidatePath(`/campanhas/${campanhaId}/producao`);
  redirect(`/campanhas/${campanhaId}/producao`);
}

export async function atualizarLinhaProducao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const linhaId = String(formData.get("linha_id") ?? "");

  const { error } = await supabase
    .from("campanhas_producao")
    .update({
      quantidade_apolices: numeroOuZero(formData, "quantidade_apolices"),
      premio_liquido: numeroOuZero(formData, "premio_liquido"),
      comissao_gerada: numeroOuZero(formData, "comissao_gerada"),
      repasse_gerado: numeroOuZero(formData, "repasse_gerado"),
      atualizado_por: user.id,
      atualizado_por_email: user.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", linhaId);

  if (error) {
    redirect(`/campanhas/${campanhaId}/producao?erro=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/campanhas/${campanhaId}/producao`);
  redirect(`/campanhas/${campanhaId}/producao`);
}

export async function removerLinhaProducao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const linhaId = String(formData.get("linha_id") ?? "");
  await supabase.from("campanhas_producao").delete().eq("id", linhaId);

  revalidatePath(`/campanhas/${campanhaId}/producao`);
  redirect(`/campanhas/${campanhaId}/producao`);
}
