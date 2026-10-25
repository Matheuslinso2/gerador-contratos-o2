"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// ERP O2 — revisão manual do vínculo endosso → apólice (Matheus 25/10/2026: todo endosso é filho de uma apólice).
// Para os endossos que a ligação automática (seguradora + nº da apólice) não resolveu: a equipe informa o Código O2
// da apólice. Fica registrado na trilha do documento (erp_documento_eventos) quem ligou e quando.
export async function ligarEndossoApolice(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const id = String(formData.get("id") ?? "");
  const codigo = String(formData.get("codigo_o2") ?? "").replace(/\D/g, "");
  const volta = (erro?: string) => redirect(`/erp/documentos/${id}${erro ? `?vinculo=${erro}` : "?vinculo=ok"}`);
  if (!id || !codigo) volta("dados");

  const { data: endosso } = await supabase.from("erp_documentos").select("id, tipo, seguradora_id, documento_pai_id").eq("id", id).maybeSingle();
  if (!endosso || endosso.tipo === "A" || endosso.tipo === "F") volta("nao_endosso");
  const { data: apolice } = await supabase.from("erp_documentos").select("id, tipo, seguradora_id").eq("nosso_numero", Number(codigo)).maybeSingle();
  if (!apolice || !["A", "F"].includes(apolice.tipo) || apolice.id === id) volta("nao_achou");
  if (apolice!.seguradora_id && endosso!.seguradora_id && apolice!.seguradora_id !== endosso!.seguradora_id) volta("seguradora");

  const { error } = await supabase.from("erp_documentos").update({ documento_pai_id: apolice!.id }).eq("id", id);
  if (error) volta("gravar");
  await supabase.from("erp_documento_eventos").insert({
    documento_id: id,
    tipo: "vinculo_apolice",
    data: new Date().toISOString(),
    canal: "erp",
    usuario_email: user!.email,
    detalhes: { codigo_o2_apolice: Number(codigo), anterior: endosso!.documento_pai_id },
  });
  revalidatePath(`/erp/documentos/${id}`);
  volta();
}
