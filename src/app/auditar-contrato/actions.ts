"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { auditarContrato } from "@/lib/auditorContrato";

export async function auditar(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!imobiliaria) throw new Error("Cadastre sua imobiliária primeiro.");

  const arquivo = formData.get("arquivo") as File | null;
  let texto = String(formData.get("texto") ?? "").trim();
  let nomeArquivo: string | null = null;

  if (arquivo && arquivo.size > 0) {
    nomeArquivo = arquivo.name;
    const nomeLower = arquivo.name.toLowerCase();
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    if (nomeLower.endsWith(".docx")) {
      texto = await extrairTextoDocx(buffer);
    } else if (nomeLower.endsWith(".pdf")) {
      texto = await extrairTextoPdf(buffer);
    } else {
      throw new Error("Envie um arquivo .docx ou .pdf, ou cole o texto do contrato.");
    }
  }

  if (!texto) {
    throw new Error(
      arquivo && arquivo.size > 0
        ? "Não foi possível ler texto deste arquivo (pode ser um PDF escaneado, sem texto real). Tente colar o texto manualmente."
        : "Cole o texto do contrato ou envie um arquivo .docx/.pdf."
    );
  }

  const relatorio = await auditarContrato(texto);

  const { data: auditoria, error } = await supabase
    .from("auditorias_contrato")
    .insert({
      imobiliaria_id: imobiliaria.id,
      nome_arquivo: nomeArquivo,
      status_geral: relatorio.status_geral,
      tipo_garantia_identificada: relatorio.tipo_garantia_identificada,
      relatorio,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  redirect(`/auditar-contrato?ultimo=${auditoria.id}`);
}
