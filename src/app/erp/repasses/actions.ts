"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { REPASSE_PAGO_PELO_ERP } from "@/lib/erp/repasse";

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
  if (!REPASSE_PAGO_PELO_ERP) redirect(`/erp/repasses?erro=${encodeURIComponent("O ERP ainda não paga repasse: ele serve só para conferir com o Corp até o Corp ser desligado.")}`);
  const imobiliaria = String(formData.get("imobiliaria_id") ?? "");
  const mes = String(formData.get("mes") ?? "");
  if (!imobiliaria || !mesOk(mes)) redirect(`/erp/repasses?erro=${encodeURIComponent("dados incompletos")}`);
  const { data, error } = await supabase.rpc("erp_autorizar_repasse", { p_imobiliaria: imobiliaria, p_mes: `${mes}-01` });
  if (error) redirect(`/erp/repasses?mes=${mes}&erro=${encodeURIComponent(error.message)}`);
  const r = data as { parcelas: number; liquido: number };
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
  revalidatePath("/erp/repasses");
  revalidatePath("/erp/repasses/autorizados");
  redirect(`${volta}ok=${encodeURIComponent("Autorização cancelada: as parcelas voltaram para pendentes")}`);
}
