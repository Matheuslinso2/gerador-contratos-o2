"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { auditarContrato, type FonteDocumento } from "@/lib/auditorContrato";

// Analisar um PDF escaneado de várias páginas (a IA lendo direto das
// imagens) demora bem mais que um contrato em texto — o padrão da Vercel
// (10s) corta a operação no meio do caminho. Dá mais fôlego.
export const maxDuration = 60;

async function extrairTextoDeCampo(
  formData: FormData,
  campoTexto: string,
  campoArquivo: string
): Promise<{ texto: string; nomeArquivo: string | null; pdfBase64: string | null }> {
  const arquivo = formData.get(campoArquivo) as File | null;
  let texto = String(formData.get(campoTexto) ?? "").trim();
  let nomeArquivo: string | null = null;
  let pdfBase64: string | null = null;

  if (arquivo && arquivo.size > 0) {
    nomeArquivo = arquivo.name;
    const nomeLower = arquivo.name.toLowerCase();
    const ehPdf = nomeLower.endsWith(".pdf");

    if (!nomeLower.endsWith(".docx") && !ehPdf) {
      redirect(
        `/auditar-contrato?erro=${encodeURIComponent(
          "Envie um arquivo .docx ou .pdf, ou cole o texto diretamente."
        )}`
      );
    }

    const buffer = Buffer.from(await arquivo.arrayBuffer());
    try {
      texto = ehPdf ? await extrairTextoPdf(buffer) : await extrairTextoDocx(buffer);
    } catch {
      redirect(
        `/auditar-contrato?erro=${encodeURIComponent(
          `Não foi possível ler o arquivo "${arquivo.name}" — ele pode estar corrompido ou num formato inesperado.`
        )}`
      );
    }

    // PDF escaneado (sem texto real): guarda os bytes originais pra IA ler
    // direto das páginas do documento, em vez de depender de texto extraído.
    if (ehPdf && !texto.trim()) {
      pdfBase64 = buffer.toString("base64");
    }
  }

  return { texto, nomeArquivo, pdfBase64 };
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

  const { texto, nomeArquivo, pdfBase64 } = await extrairTextoDeCampo(formData, "texto", "arquivo");

  let fonteContrato: FonteDocumento;
  if (texto) {
    fonteContrato = { tipo: "texto", texto };
  } else if (pdfBase64) {
    fonteContrato = { tipo: "pdf", base64: pdfBase64 };
  } else {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        "Cole o texto do contrato ou envie um arquivo .docx/.pdf."
      )}`
    );
  }

  const { texto: textoCotacao, pdfBase64: pdfBase64Cotacao } = await extrairTextoDeCampo(
    formData,
    "texto_cotacao",
    "arquivo_cotacao"
  );
  const fonteCotacao: FonteDocumento | null = textoCotacao
    ? { tipo: "texto", texto: textoCotacao }
    : pdfBase64Cotacao
      ? { tipo: "pdf", base64: pdfBase64Cotacao }
      : null;

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
    relatorio = await auditarContrato(fonteContrato, bibliotecaClausulas, fonteCotacao);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao analisar o contrato.";
    redirect(`/auditar-contrato?erro=${encodeURIComponent(mensagem)}`);
  }

  const naoVazio = (valor: string | undefined | null) =>
    valor && valor.trim() ? valor.trim() : "Não identificado";
  relatorio.locador_identificado = naoVazio(relatorio.locador_identificado);
  relatorio.locatario_identificado = naoVazio(relatorio.locatario_identificado);
  relatorio.endereco_identificado = naoVazio(relatorio.endereco_identificado);

  const { data: auditoria, error } = await supabase
    .from("auditorias_contrato")
    .insert({
      imobiliaria_id: imobiliaria.id,
      nome_arquivo: nomeArquivo,
      status_geral: relatorio.status_geral,
      tipo_garantia_identificada: relatorio.tipo_garantia_identificada,
      locador_identificado: relatorio.locador_identificado,
      locatario_identificado: relatorio.locatario_identificado,
      endereco_identificado: relatorio.endereco_identificado,
      relatorio,
      texto_contrato: texto || "[Lido diretamente das páginas do PDF escaneado — sem texto extraído]",
    })
    .select("id")
    .single();
  if (error) redirect(`/auditar-contrato?erro=${encodeURIComponent(error.message)}`);

  redirect(`/auditar-contrato?ultimo=${auditoria.id}`);
}
