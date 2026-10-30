"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// ERP O2 — repasse. Autorizar grava o lote da imobiliária (valores travados) e cancelar desfaz enquanto o Nibo não confirmou o pagamento.
// O pagamento NÃO é marcado aqui: só o Nibo confirma (erp_conferir_pagamentos_repasse).
async function exigirColaborador() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/erp");
  return supabase;
}

const mesOk = (m: string) => /^\d{4}-\d{2}$/.test(m);

export async function autorizarRepasse(formData: FormData) {
  const supabase = await exigirColaborador();
  const imobiliaria = String(formData.get("imobiliaria_id") ?? "");
  const mes = String(formData.get("mes") ?? "");
  if (!imobiliaria || !mesOk(mes)) redirect(`/erp/repasses?erro=${encodeURIComponent("dados incompletos")}`);
  const { data, error } = await supabase.rpc("erp_autorizar_repasse", { p_imobiliaria: imobiliaria, p_mes: `${mes}-01` });
  if (error) redirect(`/erp/repasses?mes=${mes}&erro=${encodeURIComponent(error.message)}`);
  const r = data as { parcelas: number; liquido: number };
  await supabase.rpc("erp_atualizar_repasse_resumo", { p_mes: `${mes}-01` });
  revalidatePath("/erp/repasses");
  revalidatePath("/erp/repasses/autorizados");
  redirect(`/erp/repasses?mes=${mes}&ok=${encodeURIComponent(`Repasse autorizado: ${r.parcelas} parcela(s), líquido R$ ${Number(r.liquido).toFixed(2).replace(".", ",")}`)}`);
}

export async function cancelarAutorizacao(formData: FormData) {
  const supabase = await exigirColaborador();
  const lote = String(formData.get("lote_id") ?? "");
  const mes = String(formData.get("mes") ?? "");
  const volta = `/erp/repasses/autorizados${mesOk(mes) ? `?mes=${mes}&` : "?"}`;
  if (!lote) redirect(`${volta}erro=${encodeURIComponent("lote não informado")}`);
  const { error } = await supabase.rpc("erp_cancelar_autorizacao_repasse", { p_lote: lote });
  if (error) redirect(`${volta}erro=${encodeURIComponent(error.message)}`);
  await supabase.rpc("erp_atualizar_repasse_resumo_abertos");
  revalidatePath("/erp/repasses");
  revalidatePath("/erp/repasses/autorizados");
  redirect(`${volta}ok=${encodeURIComponent("Autorização cancelada: as parcelas voltaram para pendentes")}`);
}

// Refaz o retrato (tabela pronta) de um mês de repasse — também roda por cron.
export async function atualizarResumoRepasse(formData: FormData) {
  const supabase = await exigirColaborador();
  const mes = String(formData.get("mes") ?? "");
  if (!mesOk(mes)) redirect("/erp/repasses");
  const { error } = await supabase.rpc("erp_atualizar_repasse_resumo", { p_mes: `${mes}-01` });
  if (error) redirect(`/erp/repasses?mes=${mes}&erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/erp/repasses");
  redirect(`/erp/repasses?mes=${mes}`);
}
