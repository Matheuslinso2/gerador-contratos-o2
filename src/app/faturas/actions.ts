"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { resolverOuCriarImobiliaria } from "@/lib/faturasIdentificacao";

async function checarAcesso() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return supabase;
}

// Adiciona uma imobiliária nova à lista de esperadas de uma seguradora —
// usado quando surge um parceiro que ainda não estava na planilha de
// controle original.
export async function adicionarEsperada(formData: FormData) {
  const supabase = await checarAcesso();

  const nome = String(formData.get("nome") ?? "").trim();
  const cnpj = String(formData.get("cnpj") ?? "").trim();
  const seguradora = String(formData.get("seguradora") ?? "").trim();
  const diaVencimento = String(formData.get("dia_vencimento") ?? "").trim();
  const cnpjO2 = String(formData.get("cnpj_o2") ?? "").trim();
  const observacao = String(formData.get("observacao") ?? "").trim();

  if (!nome || !cnpj || !seguradora) {
    redirect(`/faturas?erro=${encodeURIComponent("Informe ao menos nome, CNPJ e seguradora.")}&seguradora=${encodeURIComponent(seguradora)}`);
  }

  let imobiliariaId: string;
  try {
    imobiliariaId = await resolverOuCriarImobiliaria(supabase, nome, cnpj);
  } catch (e) {
    redirect(
      `/faturas?erro=${encodeURIComponent(e instanceof Error ? e.message : "Falha ao registrar imobiliária.")}&seguradora=${encodeURIComponent(seguradora)}`
    );
  }

  const { error } = await supabase.from("faturas_esperadas").upsert(
    {
      imobiliaria_id: imobiliariaId,
      seguradora,
      codigo_produtor: "",
      dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
      cnpj_o2: cnpjO2 || null,
      observacao: observacao || null,
      ativo: true,
    },
    { onConflict: "imobiliaria_id, seguradora, codigo_produtor" }
  );
  if (error) {
    redirect(`/faturas?erro=${encodeURIComponent(error.message)}&seguradora=${encodeURIComponent(seguradora)}`);
  }

  redirect(`/faturas?ok=${encodeURIComponent("Imobiliária adicionada.")}&seguradora=${encodeURIComponent(seguradora)}`);
}

// Edita dia de vencimento, CNPJ da O2 e observação de um vínculo já
// existente — os colaboradores vão precisar ajustar isso aos poucos.
export async function editarEsperada(formData: FormData) {
  const supabase = await checarAcesso();

  const id = String(formData.get("id") ?? "");
  const seguradora = String(formData.get("seguradora") ?? "").trim();
  const diaVencimento = String(formData.get("dia_vencimento") ?? "").trim();
  const cnpjO2 = String(formData.get("cnpj_o2") ?? "").trim();
  const observacao = String(formData.get("observacao") ?? "").trim();
  if (!id) redirect(`/faturas?erro=${encodeURIComponent("Registro inválido.")}`);

  const { error } = await supabase
    .from("faturas_esperadas")
    .update({
      dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
      cnpj_o2: cnpjO2 || null,
      observacao: observacao || null,
    })
    .eq("id", id);
  if (error) {
    redirect(`/faturas?erro=${encodeURIComponent(error.message)}&seguradora=${encodeURIComponent(seguradora)}`);
  }

  redirect(`/faturas?ok=${encodeURIComponent("Atualizado.")}&seguradora=${encodeURIComponent(seguradora)}`);
}
