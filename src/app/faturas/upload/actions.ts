"use server";

import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { abrirTextoPdfComSenha, apenasDigitos } from "@/lib/pdfComSenha";
import { extrairDadosFatura } from "@/lib/faturasIA";
import {
  buscarImobiliariaPorCnpj,
  sugerirImobiliariaPorTexto,
  type ImobiliariaBasica,
} from "@/lib/faturasIdentificacao";

const BUCKET_TEMP = "faturas-temp";
const BUCKET_FINAL = "faturas";

// O upload do PDF em si acontece direto do navegador pro bucket temporário
// (ver UploadFaturaForm.tsx) — mesmo motivo do Auditor de Contrato: o corpo
// de uma Server Action na Vercel tem teto de ~4,5 MB. Essa action só recebe
// o caminho do arquivo.
export async function processarFaturaUpload(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const competencia = String(formData.get("competencia") ?? "").trim();
  const path = String(formData.get("arquivo_path") ?? "").trim();
  const nomeArquivo = String(formData.get("arquivo_nome") ?? "").trim();

  if (!competencia || !path) {
    redirect(`/faturas/upload?erro=${encodeURIComponent("Selecione a competência e envie um arquivo PDF.")}`);
  }

  const { data: baixado, error: erroDownload } = await supabase.storage.from(BUCKET_TEMP).download(path);
  if (erroDownload || !baixado) {
    redirect(
      `/faturas/upload?erro=${encodeURIComponent("Não foi possível recuperar o arquivo enviado. Tente novamente.")}`
    );
  }
  const buffer = Buffer.from(await baixado.arrayBuffer());
  void supabase.storage.from(BUCKET_TEMP).remove([path]);

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const { data: duplicata } = await supabase
    .from("faturas")
    .select("id")
    .eq("arquivo_hash", hash)
    .maybeSingle();

  const { data: imobiliariasData } = await supabase.from("imobiliarias").select("id, nome, cnpj");
  const imobiliarias = (imobiliariasData ?? []) as ImobiliariaBasica[];
  const senhasCandidatas = imobiliarias.map((i) => (i.cnpj ? apenasDigitos(i.cnpj) : "")).filter(Boolean);

  const resultado = await abrirTextoPdfComSenha(buffer, senhasCandidatas);

  const pathFinal = `${competencia}/${crypto.randomUUID()}.pdf`;
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_FINAL)
    .upload(pathFinal, buffer, { contentType: "application/pdf" });
  if (erroUpload) {
    redirect(`/faturas/upload?erro=${encodeURIComponent("Falha ao salvar o arquivo: " + erroUpload.message)}`);
  }

  const historico = [{ usuario: user.email, data: new Date().toISOString(), acao: "upload", detalhe: nomeArquivo }];

  if (!resultado) {
    // Não abriu com nenhum CNPJ já cadastrado — fica pra conferência manual
    // informar a senha certa.
    const { error } = await supabase
      .from("faturas")
      .insert({
        competencia,
        arquivo_bucket_path: pathFinal,
        arquivo_nome: nomeArquivo,
        arquivo_hash: hash,
        status: duplicata ? "duplicada" : "aguardando_conferencia",
        possivel_duplicidade_de: duplicata?.id ?? null,
        confianca: null,
        historico_identificacao: historico,
        criado_por: user.id,
        criado_por_email: user.email,
      })
      .select("id")
      .single();
    if (error) redirect(`/faturas/upload?erro=${encodeURIComponent(error.message)}`);
    redirect(
      `/faturas?aviso=${encodeURIComponent(
        `"${nomeArquivo}" não abriu com nenhum CNPJ cadastrado — informe a imobiliária/senha na conferência.`
      )}`
    );
  }

  const { texto, senhaCorreta } = resultado;

  let identificacao = senhaCorreta ? buscarImobiliariaPorCnpj(senhaCorreta, imobiliarias) : null;

  let dadosIA = null;
  try {
    dadosIA = await extrairDadosFatura(texto);
  } catch (e) {
    console.error("[faturas] erro ao extrair dados por IA:", e);
  }

  if (!identificacao && dadosIA?.identificacao_texto) {
    identificacao = sugerirImobiliariaPorTexto(dadosIA.identificacao_texto, imobiliarias);
  }

  const status = duplicata
    ? "duplicada"
    : !identificacao?.imobiliaria_id
      ? "aguardando_identificacao"
      : identificacao.confianca === "alta"
        ? "fatura_carregada"
        : "aguardando_conferencia";

  const { error } = await supabase
    .from("faturas")
    .insert({
      competencia,
      arquivo_bucket_path: pathFinal,
      arquivo_nome: nomeArquivo,
      arquivo_hash: hash,
      imobiliaria_id: identificacao?.imobiliaria_id ?? null,
      seguradora: dadosIA?.seguradora ?? null,
      codigo_produtor: dadosIA?.codigo_produtor ?? null,
      vencimento: dadosIA?.vencimento ?? null,
      valor: dadosIA?.valor ?? null,
      numero_documento: dadosIA?.numero_documento ?? null,
      confianca: identificacao?.confianca ?? null,
      status,
      possivel_duplicidade_de: duplicata?.id ?? null,
      texto_bruto_extraido: texto || null,
      historico_identificacao: historico,
      criado_por: user.id,
      criado_por_email: user.email,
    })
    .select("id")
    .single();
  if (error) redirect(`/faturas/upload?erro=${encodeURIComponent(error.message)}`);

  redirect(`/faturas?ok=${encodeURIComponent(`"${nomeArquivo}" processado.`)}`);
}
