"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// Registro do motivo de uma saída (ou entrada) da fatura que o ERP não explicou sozinho — fica com quem registrou e quando.
export async function registrarMovimentacao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");
  const faturaId = String(formData.get("fatura_id") ?? "");
  const competencia = String(formData.get("competencia") ?? "");
  const movimento = String(formData.get("movimento") ?? "saida");
  const apolice = String(formData.get("apolice") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  const volta = `/erp/faturas/${faturaId}?mes=${competencia}`;
  if (!faturaId || !/^\d{4}-\d{2}$/.test(competencia) || !apolice || !motivo || !["entrada", "saida"].includes(movimento)) redirect(volta);
  const documentoId = String(formData.get("documento_id") ?? "") || null;
  await supabase.from("erp_fatura_movimentacoes").upsert(
    {
      fatura_id: faturaId,
      competencia,
      movimento,
      apolice,
      documento_id: documentoId,
      motivo,
      observacao: String(formData.get("observacao") ?? "").trim() || null,
      referencia: String(formData.get("referencia") ?? "").trim() || null,
      usuario_email: user!.email,
      criado_em: new Date().toISOString(),
    },
    { onConflict: "fatura_id,competencia,movimento,apolice" }
  );
  revalidatePath(`/erp/faturas/${faturaId}`);
  redirect(volta);
}
