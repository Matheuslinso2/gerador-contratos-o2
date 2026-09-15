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

// Uma única ação pra criar OU atualizar a linha (upsert por
// campanha_id+imobiliaria_id) -- a tela da campanha já lista toda
// imobiliária impactada (via campanhas_envios) como linha editável, tenha
// ou não produção lançada ainda, então não existe mais um formulário
// separado de "adicionar": salvar uma linha nova ou uma já existente é a
// mesma ação.
export async function salvarLinhaProducao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  if (!campanhaId || !imobiliariaId) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Imobiliária inválida.")}`);
  }

  const { error } = await supabase.from("campanhas_producao").upsert(
    {
      campanha_id: campanhaId,
      imobiliaria_id: imobiliariaId,
      quantidade_apolices: numeroOuZero(formData, "quantidade_apolices"),
      premio_liquido: numeroOuZero(formData, "premio_liquido"),
      comissao_gerada: numeroOuZero(formData, "comissao_gerada"),
      repasse_gerado: numeroOuZero(formData, "repasse_gerado"),
      atualizado_por: user.id,
      atualizado_por_email: user.email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "campanha_id,imobiliaria_id" }
  );

  if (error) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/campanhas/${campanhaId}`);
  redirect(`/campanhas/${campanhaId}`);
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
  if (linhaId) {
    await supabase.from("campanhas_producao").delete().eq("id", linhaId);
  }

  revalidatePath(`/campanhas/${campanhaId}`);
  redirect(`/campanhas/${campanhaId}`);
}
