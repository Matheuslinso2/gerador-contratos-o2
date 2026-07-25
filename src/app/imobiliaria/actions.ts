"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";

export async function salvarImobiliaria(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const nome = String(formData.get("nome") ?? "").trim();
  const cnpj = String(formData.get("cnpj") ?? "").trim();
  const creci = String(formData.get("creci") ?? "").trim();
  const telefone = String(formData.get("telefone") ?? "").trim();
  const endereco = String(formData.get("endereco") ?? "").trim();
  const indice_reajuste = String(formData.get("indice_reajuste") ?? "").trim();
  const percentual_multa_atraso = Number(formData.get("percentual_multa_atraso"));
  const percentual_juros_mora = Number(formData.get("percentual_juros_mora"));
  const percentual_honorarios_advocaticios = Number(
    formData.get("percentual_honorarios_advocaticios")
  );
  const dia_vencimento_aluguel = Number(formData.get("dia_vencimento_aluguel"));
  const plataforma_assinatura = String(formData.get("plataforma_assinatura") ?? "").trim();
  const logo = formData.get("logo") as File | null;
  const contratoArquivo = formData.get("contrato_arquivo") as File | null;

  let texto_base_contrato = String(formData.get("texto_base_contrato") ?? "").trim();

  if (contratoArquivo && contratoArquivo.size > 0) {
    const nomeArquivo = contratoArquivo.name.toLowerCase();
    if (!nomeArquivo.endsWith(".docx")) {
      throw new Error("O arquivo do contrato precisa estar em formato Word (.docx).");
    }
    const buffer = Buffer.from(await contratoArquivo.arrayBuffer());
    texto_base_contrato = await extrairTextoDocx(buffer);
  }

  if (!nome || !cnpj || !texto_base_contrato || !indice_reajuste || !dia_vencimento_aluguel) {
    return;
  }

  let logo_url: string | null = null;
  if (logo && logo.size > 0) {
    const ext = logo.name.split(".").pop() || "png";
    const path = `${user.id}-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("logos").upload(path, logo, {
      contentType: logo.type,
    });
    if (uploadError) throw new Error(uploadError.message);
    logo_url = supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
  }

  const dados: Record<string, unknown> = {
    user_id: user.id,
    nome,
    cnpj,
    creci: creci || null,
    telefone: telefone || null,
    endereco: endereco || null,
    texto_base_contrato,
    indice_reajuste,
    percentual_multa_atraso,
    percentual_juros_mora,
    percentual_honorarios_advocaticios,
    dia_vencimento_aluguel,
    plataforma_assinatura: plataforma_assinatura || null,
  };
  if (logo_url) dados.logo_url = logo_url;

  const { error } = await supabase.from("imobiliarias").upsert(dados, { onConflict: "user_id" });
  if (error) throw new Error(error.message);

  revalidatePath("/imobiliaria");
  redirect("/imobiliaria?sucesso=1");
}
