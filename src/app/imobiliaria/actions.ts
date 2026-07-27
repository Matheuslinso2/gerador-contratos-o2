"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";
import { enviarEmail } from "@/lib/email";

export async function salvarImobiliaria(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nome = String(formData.get("nome") ?? "").trim();
  const cnpj = String(formData.get("cnpj") ?? "").trim();
  const creci = String(formData.get("creci") ?? "").trim();
  const telefone = String(formData.get("telefone") ?? "").trim();
  const endereco = String(formData.get("endereco") ?? "").trim();
  const indice_reajuste = String(formData.get("indice_reajuste") ?? "").trim();
  const clausula_fiador = String(formData.get("clausula_fiador") ?? "").trim();
  const clausula_caucao = String(formData.get("clausula_caucao") ?? "").trim();
  const percentual_multa_atraso = Number(formData.get("percentual_multa_atraso"));
  const percentual_juros_mora = Number(formData.get("percentual_juros_mora"));
  const percentual_honorarios_advocaticios = Number(
    formData.get("percentual_honorarios_advocaticios")
  );
  const plataforma_assinatura = String(formData.get("plataforma_assinatura") ?? "").trim();
  const logo = formData.get("logo") as File | null;
  const contratoArquivo = formData.get("contrato_arquivo") as File | null;

  let texto_base_contrato = String(formData.get("texto_base_contrato") ?? "").trim();

  if (contratoArquivo && contratoArquivo.size > 0) {
    const nomeArquivo = contratoArquivo.name.toLowerCase();
    if (!nomeArquivo.endsWith(".docx")) {
      redirect(
        `/imobiliaria?erro=${encodeURIComponent("O arquivo do contrato precisa estar em formato Word (.docx).")}`
      );
    }
    const buffer = Buffer.from(await contratoArquivo.arrayBuffer());
    try {
      texto_base_contrato = await extrairTextoDocx(buffer);
    } catch {
      redirect(
        `/imobiliaria?erro=${encodeURIComponent(
          `Não foi possível ler o arquivo "${contratoArquivo.name}" — ele pode estar corrompido ou num formato inesperado.`
        )}`
      );
    }
  }

  if (!nome || !cnpj || !texto_base_contrato || !indice_reajuste) {
    return;
  }

  const { data: imobiliariaExistente } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const primeiroCadastro = !imobiliariaExistente;

  let logo_url: string | null = null;
  if (logo && logo.size > 0) {
    const ext = logo.name.split(".").pop() || "png";
    const path = `${user.id}-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("logos").upload(path, logo, {
      contentType: logo.type,
    });
    if (uploadError) redirect(`/imobiliaria?erro=${encodeURIComponent(uploadError.message)}`);
    logo_url = supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
  }

  const dados: Record<string, unknown> = {
    user_id: user.id,
    email: user.email,
    nome,
    cnpj,
    creci: creci || null,
    telefone: telefone || null,
    endereco: endereco || null,
    texto_base_contrato,
    indice_reajuste,
    clausula_fiador: clausula_fiador || null,
    clausula_caucao: clausula_caucao || null,
    percentual_multa_atraso,
    percentual_juros_mora,
    percentual_honorarios_advocaticios,
    plataforma_assinatura: plataforma_assinatura || null,
  };
  if (logo_url) dados.logo_url = logo_url;

  const { error } = await supabase.from("imobiliarias").upsert(dados, { onConflict: "user_id" });
  if (error) redirect(`/imobiliaria?erro=${encodeURIComponent(error.message)}`);

  if (primeiroCadastro) {
    await enviarEmail({
      para: "comercial@o2seguros.com.br",
      assunto: `Nova imobiliária cadastrada: ${nome}`,
      html: `
        <h2>Nova imobiliária cadastrada no Gerador de Contratos</h2>
        <p><strong>Nome:</strong> ${nome}</p>
        <p><strong>CNPJ:</strong> ${cnpj}</p>
        <p><strong>CRECI:</strong> ${creci || "não informado"}</p>
        <p><strong>Telefone:</strong> ${telefone || "não informado"}</p>
        <p><strong>Endereço:</strong> ${endereco || "não informado"}</p>
        <p><strong>E-mail de login:</strong> ${user.email}</p>
        <p><strong>Índice de reajuste:</strong> ${indice_reajuste}</p>
        <p><strong>Plataforma de assinatura:</strong> ${plataforma_assinatura || "não informado"}</p>
      `,
    });
  }

  revalidatePath("/imobiliaria");
  redirect("/imobiliaria?sucesso=1");
}
