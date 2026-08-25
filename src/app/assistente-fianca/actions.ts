"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { extrairTextoPdfComPaginas } from "@/lib/extrairTextoPdf";
import { analisarPanoramaFianca, type AnaliseFianca, type FonteEntrada } from "@/lib/assistenteFianca";

const EXTENSOES_IMAGEM: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function entradaDoArquivo(arquivo: File): Promise<FonteEntrada> {
  const nomeLower = arquivo.name.toLowerCase();
  const buffer = Buffer.from(await arquivo.arrayBuffer());

  if (nomeLower.endsWith(".pdf")) {
    // PDF com texto real extraível é lido como texto (mais barato e mais
    // confiável). PDF escaneado (sem texto, ou só um carimbo de scanner)
    // vai direto pra IA como documento, pra ela ler das páginas.
    const { texto, numPaginas } = await extrairTextoPdfComPaginas(buffer);
    const textoInsuficiente = numPaginas > 0 && texto.length / numPaginas < 200;
    if (texto.trim() && !textoInsuficiente) {
      return { tipo: "texto", texto };
    }
    return { tipo: "pdf", base64: buffer.toString("base64") };
  }

  const extensao = Object.keys(EXTENSOES_IMAGEM).find((ext) => nomeLower.endsWith(ext));
  if (!extensao) {
    throw new Error("Envie uma imagem (.png, .jpg, .jpeg, .gif, .webp) ou um PDF.");
  }
  return { tipo: "imagem", base64: buffer.toString("base64"), mediaType: EXTENSOES_IMAGEM[extensao] };
}

export async function analisar(formData: FormData): Promise<{ id: string; analise: AnaliseFianca }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || (!isAdmin(user.email) && !isColaboradorO2(user.email))) {
    throw new Error("Sem permissão para usar o assistente de vendas.");
  }

  const texto = String(formData.get("panorama") ?? "").trim();
  const arquivo = formData.get("arquivo") as File | null;

  let entrada: FonteEntrada;
  let entradaArquivoNome: string | null = null;
  if (arquivo && arquivo.size > 0) {
    entrada = await entradaDoArquivo(arquivo);
    entradaArquivoNome = arquivo.name;
  } else if (texto) {
    entrada = { tipo: "texto", texto };
  } else {
    throw new Error("Cole o panorama do caso ou anexe um print/PDF das cotações.");
  }

  const analise = await analisarPanoramaFianca(entrada);

  const { data: registro, error } = await supabase
    .from("assistente_fianca_analises")
    .insert({
      criado_por: user.email,
      entrada_tipo: entrada.tipo,
      entrada_texto: entrada.tipo === "texto" ? entrada.texto : null,
      entrada_arquivo_nome: entradaArquivoNome,
      resultado: analise,
    })
    .select("id")
    .single();
  if (error || !registro) {
    throw new Error("Análise gerada, mas não foi possível registrá-la para feedback. Tente novamente.");
  }

  return { id: registro.id, analise };
}

export async function enviarFeedback(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || (!isAdmin(user.email) && !isColaboradorO2(user.email))) {
    throw new Error("Sem permissão para enviar feedback.");
  }

  const id = String(formData.get("id") ?? "").trim();
  const precisao = Number(formData.get("precisao"));
  const utilidade = Number(formData.get("utilidade"));
  const comentario = String(formData.get("comentario") ?? "").trim();

  if (!id) throw new Error("Análise não identificada.");
  if (!Number.isInteger(precisao) || precisao < 1 || precisao > 5) {
    throw new Error("Avalie a precisão da análise de 1 a 5.");
  }
  if (!Number.isInteger(utilidade) || utilidade < 1 || utilidade > 5) {
    throw new Error("Avalie o quanto a análise ajudou de 1 a 5.");
  }

  const { error } = await supabase
    .from("assistente_fianca_analises")
    .update({
      feedback_precisao: precisao,
      feedback_utilidade: utilidade,
      feedback_comentario: comentario || null,
      feedback_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("criado_por", user.email);
  if (error) throw new Error("Não foi possível registrar o feedback. Tente novamente.");
}
