"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { auditarContrato, type FonteDocumento } from "@/lib/auditorContrato";

const BUCKET_TEMP = "auditoria-temp";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// O arquivo já chega no servidor só como um caminho no Storage — o upload
// em si aconteceu direto do navegador (ver AuditorForm.tsx), porque o corpo
// de uma Server Action na Vercel tem um teto de ~4,5 MB, e contratos
// escaneados com laudo de vistoria passam disso fácil.
const EXTENSOES_IMAGEM: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function extrairDeCampo(
  supabase: SupabaseServerClient,
  formData: FormData,
  campoTexto: string,
  campoPath: string,
  campoNome: string
): Promise<{
  texto: string;
  nomeArquivo: string | null;
  pdfBase64: string | null;
  imagemBase64: string | null;
  imagemMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null;
}> {
  const texto0 = String(formData.get(campoTexto) ?? "").trim();
  const path = String(formData.get(campoPath) ?? "").trim();
  const nomeArquivo = String(formData.get(campoNome) ?? "").trim() || null;

  if (!path) {
    return { texto: texto0, nomeArquivo: null, pdfBase64: null, imagemBase64: null, imagemMediaType: null };
  }

  const nomeLower = (nomeArquivo ?? path).toLowerCase();
  const ehPdf = nomeLower.endsWith(".pdf");
  const extensaoImagem = Object.keys(EXTENSOES_IMAGEM).find((ext) => nomeLower.endsWith(ext));
  if (!nomeLower.endsWith(".docx") && !ehPdf && !extensaoImagem) {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        "Envie um arquivo .docx, .pdf ou uma imagem (print de tela em .png/.jpg), ou cole o texto diretamente."
      )}`
    );
  }

  const { data, error } = await supabase.storage.from(BUCKET_TEMP).download(path);
  if (error || !data) {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        "Não foi possível recuperar o arquivo enviado. Tente novamente."
      )}`
    );
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  void supabase.storage.from(BUCKET_TEMP).remove([path]);

  // Imagem/print de tela: não tem texto pra extrair, manda os bytes direto
  // pra IA "ver" o conteúdo, igual já fazíamos com PDF escaneado.
  if (extensaoImagem) {
    return {
      texto: "",
      nomeArquivo,
      pdfBase64: null,
      imagemBase64: buffer.toString("base64"),
      imagemMediaType: EXTENSOES_IMAGEM[extensaoImagem],
    };
  }

  let texto = "";
  try {
    texto = ehPdf ? await extrairTextoPdf(buffer) : await extrairTextoDocx(buffer);
  } catch {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        `Não foi possível ler o arquivo "${nomeArquivo}" — ele pode estar corrompido ou num formato inesperado.`
      )}`
    );
  }

  // PDF escaneado (sem texto real): guarda os bytes originais pra IA ler
  // direto das páginas do documento, em vez de depender de texto extraído.
  const pdfBase64 = ehPdf && !texto.trim() ? buffer.toString("base64") : null;

  return { texto, nomeArquivo, pdfBase64, imagemBase64: null, imagemMediaType: null };
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

  const { texto, nomeArquivo, pdfBase64, imagemBase64, imagemMediaType } = await extrairDeCampo(
    supabase,
    formData,
    "texto",
    "arquivo_path",
    "arquivo_nome"
  );

  let fonteContrato: FonteDocumento;
  if (texto) {
    fonteContrato = { tipo: "texto", texto };
  } else if (pdfBase64) {
    fonteContrato = { tipo: "pdf", base64: pdfBase64 };
  } else if (imagemBase64 && imagemMediaType) {
    fonteContrato = { tipo: "imagem", base64: imagemBase64, mediaType: imagemMediaType };
  } else {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        "Cole o texto do contrato ou envie um arquivo .docx/.pdf."
      )}`
    );
  }

  const {
    texto: textoCotacao,
    pdfBase64: pdfBase64Cotacao,
    imagemBase64: imagemBase64Cotacao,
    imagemMediaType: imagemMediaTypeCotacao,
  } = await extrairDeCampo(supabase, formData, "texto_cotacao", "arquivo_cotacao_path", "arquivo_cotacao_nome");
  const fonteCotacao: FonteDocumento | null = textoCotacao
    ? { tipo: "texto", texto: textoCotacao }
    : pdfBase64Cotacao
      ? { tipo: "pdf", base64: pdfBase64Cotacao }
      : imagemBase64Cotacao && imagemMediaTypeCotacao
        ? { tipo: "imagem", base64: imagemBase64Cotacao, mediaType: imagemMediaTypeCotacao }
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

  // Defesa extra: a IA às vezes deixa algum campo do checklist de fora da
  // resposta, mesmo sendo obrigatório no schema. Preenche com um valor
  // neutro em vez de deixar a tela quebrar ao exibir o relatório.
  relatorio.dados_cadastrais_status ??= "nao_avaliado";
  relatorio.dados_cadastrais_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.dados_locacao_status ??= "nao_avaliado";
  relatorio.dados_locacao_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.conferencia_cotacao_status ??= "nao_avaliado";
  relatorio.conferencia_cotacao_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.clausulas_seguradora_status ??= "nao_avaliado";
  relatorio.clausulas_seguradora_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.assinaturas_status ??= "nao_avaliado";
  relatorio.assinaturas_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.pontos_criticos ??= [];

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
