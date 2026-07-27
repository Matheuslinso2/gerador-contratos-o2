"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { auditarContrato } from "@/lib/auditorContrato";

async function extrairTextoDeCampo(
  formData: FormData,
  campoTexto: string,
  campoArquivo: string
): Promise<{ texto: string; nomeArquivo: string | null }> {
  const arquivo = formData.get(campoArquivo) as File | null;
  let texto = String(formData.get(campoTexto) ?? "").trim();
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
      redirect(
        `/auditar-contrato?erro=${encodeURIComponent(
          "Envie um arquivo .docx ou .pdf, ou cole o texto diretamente."
        )}`
      );
    }
  }

  return { texto, nomeArquivo };
}

export async function auditar(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!imobiliaria) {
    redirect(`/auditar-contrato?erro=${encodeURIComponent("Cadastre sua imobiliária primeiro.")}`);
  }

  const arquivo = formData.get("arquivo") as File | null;
  const { texto, nomeArquivo } = await extrairTextoDeCampo(formData, "texto", "arquivo");

  if (!texto) {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        arquivo && arquivo.size > 0
          ? "Não foi possível ler texto deste arquivo (pode ser um PDF escaneado, sem texto real). Tente colar o texto manualmente."
          : "Cole o texto do contrato ou envie um arquivo .docx/.pdf."
      )}`
    );
  }

  const { texto: textoCotacao } = await extrairTextoDeCampo(formData, "texto_cotacao", "arquivo_cotacao");

  const { data: produtosSeguro } = await supabase
    .from("produtos")
    .select("nome, clausula_base, seguradoras(nome)")
    .not("seguradora_id", "is", null);

  const bibliotecaClausulas = (produtosSeguro ?? []).map((p) => {
    const seguradora = Array.isArray(p.seguradoras) ? p.seguradoras[0] : p.seguradoras;
    return { seguradora: seguradora?.nome ?? "", produto: p.nome, clausulaBase: p.clausula_base };
  });

  let relatorio;
  try {
    relatorio = await auditarContrato(texto, bibliotecaClausulas, textoCotacao || null);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao analisar o contrato.";
    redirect(`/auditar-contrato?erro=${encodeURIComponent(mensagem)}`);
  }

  const { data: auditoria, error } = await supabase
    .from("auditorias_contrato")
    .insert({
      imobiliaria_id: imobiliaria.id,
      nome_arquivo: nomeArquivo,
      status_geral: relatorio.status_geral,
      tipo_garantia_identificada: relatorio.tipo_garantia_identificada,
      relatorio,
      texto_contrato: texto,
    })
    .select("id")
    .single();
  if (error) redirect(`/auditar-contrato?erro=${encodeURIComponent(error.message)}`);

  redirect(`/auditar-contrato?ultimo=${auditoria.id}`);
}
