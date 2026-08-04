"use server";

import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { abrirTextoPdfComSenha, candidatosSenhaO2 } from "@/lib/pdfComSenha";
import { extrairDadosFatura } from "@/lib/faturasIA";
import {
  buscarImobiliariaPorCnpjNoTexto,
  sugerirImobiliariaPorTexto,
  resolverOuCriarImobiliaria,
  type ImobiliariaBasica,
} from "@/lib/faturasIdentificacao";

const BUCKET_TEMP = "faturas-temp";
const BUCKET_FINAL = "faturas";

export type ResultadoProcessamento = {
  ok: boolean;
  nomeArquivo: string;
  mensagem: string;
};

// O upload do PDF em si acontece direto do navegador pro bucket temporário
// (ver UploadFaturaForm.tsx) — mesmo motivo do Auditor de Contrato: o corpo
// de uma Server Action na Vercel tem teto de ~4,5 MB. Essa action só recebe
// o caminho do arquivo.
//
// Não usa redirect() em caso de sucesso/erro de arquivo individual — devolve
// um resultado, porque o formulário chama essa action várias vezes em
// sequência (um upload em lote), e um redirect no meio do lote interromperia
// os arquivos seguintes.
export async function processarFaturaUpload(formData: FormData): Promise<ResultadoProcessamento> {
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
    return { ok: false, nomeArquivo, mensagem: "Faltou a competência ou o arquivo." };
  }

  const { data: baixado, error: erroDownload } = await supabase.storage.from(BUCKET_TEMP).download(path);
  if (erroDownload || !baixado) {
    return { ok: false, nomeArquivo, mensagem: "Não foi possível recuperar o arquivo enviado." };
  }
  const buffer = Buffer.from(await baixado.arrayBuffer());
  void supabase.storage.from(BUCKET_TEMP).remove([path]);

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const { data: duplicata } = await supabase
    .from("faturas")
    .select("id")
    .eq("arquivo_hash", hash)
    .maybeSingle();

  // A senha (quando o PDF tem uma, ex: Porto) é sempre derivada do CNPJ da
  // própria O2 — não identifica a imobiliária. Só destrava a leitura do
  // conteúdo, que é de onde vem a identificação de verdade.
  const resultado = await abrirTextoPdfComSenha(buffer, candidatosSenhaO2());

  const pathFinal = `${competencia}/${crypto.randomUUID()}.pdf`;
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_FINAL)
    .upload(pathFinal, buffer, { contentType: "application/pdf" });
  if (erroUpload) {
    return { ok: false, nomeArquivo, mensagem: `Falha ao salvar o arquivo: ${erroUpload.message}` };
  }

  const historico = [{ usuario: user.email, data: new Date().toISOString(), acao: "upload", detalhe: nomeArquivo }];

  if (!resultado) {
    // Nenhum dos CNPJs da O2 abriu — provavelmente uma senha de outro tipo,
    // fica pra conferência manual investigar.
    const { error } = await supabase.from("faturas").insert({
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
    });
    if (error) return { ok: false, nomeArquivo, mensagem: error.message };
    return { ok: true, nomeArquivo, mensagem: "Não conseguimos abrir esse PDF — precisa de conferência manual." };
  }

  const { texto } = resultado;

  let dadosIA = null;
  try {
    dadosIA = await extrairDadosFatura(texto);
  } catch (e) {
    console.error("[faturas] erro ao extrair dados por IA:", e);
  }

  const { data: conhecidasData } = await supabase.from("imobiliarias_conhecidas").select("id, nome, cnpj");
  const conhecidas = (conhecidasData ?? []) as ImobiliariaBasica[];

  // Prioridade: CNPJ lido no documento (mais confiável) > nome/razão social.
  let resultadoIdent = buscarImobiliariaPorCnpjNoTexto(dadosIA?.cnpj_tomador ?? null, conhecidas);
  if (!resultadoIdent.imobiliaria_id && dadosIA?.identificacao_texto) {
    resultadoIdent = sugerirImobiliariaPorTexto(dadosIA.identificacao_texto, conhecidas);
  }

  const conhecidaEscolhida = resultadoIdent.imobiliaria_id
    ? conhecidas.find((c) => c.id === resultadoIdent.imobiliaria_id)
    : null;

  let imobiliariaId: string | null = null;
  if (conhecidaEscolhida?.cnpj) {
    try {
      imobiliariaId = await resolverOuCriarImobiliaria(supabase, conhecidaEscolhida.nome, conhecidaEscolhida.cnpj);
    } catch (e) {
      console.error("[faturas] erro ao resolver/criar imobiliária:", e);
    }
  }

  const confianca = imobiliariaId ? resultadoIdent.confianca : null;
  const status = duplicata
    ? "duplicada"
    : !imobiliariaId
      ? "aguardando_identificacao"
      : confianca === "alta"
        ? "fatura_carregada"
        : "aguardando_conferencia";

  const { error } = await supabase.from("faturas").insert({
    competencia,
    arquivo_bucket_path: pathFinal,
    arquivo_nome: nomeArquivo,
    arquivo_hash: hash,
    imobiliaria_id: imobiliariaId,
    seguradora: dadosIA?.seguradora ?? null,
    codigo_produtor: dadosIA?.codigo_produtor ?? null,
    vencimento: dadosIA?.vencimento ?? null,
    valor: dadosIA?.valor ?? null,
    numero_documento: dadosIA?.numero_documento ?? null,
    confianca,
    status,
    possivel_duplicidade_de: duplicata?.id ?? null,
    texto_bruto_extraido: texto || null,
    historico_identificacao: historico,
    criado_por: user.id,
    criado_por_email: user.email,
  });
  if (error) return { ok: false, nomeArquivo, mensagem: error.message };

  const mensagens: Record<string, string> = {
    duplicada: "Parece duplicada de uma fatura já enviada.",
    aguardando_identificacao: "Aberta, mas não identificamos a imobiliária — precisa de conferência.",
    aguardando_conferencia: "Aberta, identificação incerta — precisa de conferência.",
    fatura_carregada: "Identificada com sucesso.",
  };

  return { ok: true, nomeArquivo, mensagem: mensagens[status] ?? "Processada." };
}
