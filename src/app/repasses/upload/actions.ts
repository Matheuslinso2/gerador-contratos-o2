"use server";

import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { abrirTextoPdfComSenha } from "@/lib/pdfComSenha";
import { extrairDadosRepasse } from "@/lib/repassesIA";
import {
  buscarImobiliariaPorCodigoProdutor,
  buscarImobiliariaPorCpfCnpj,
  sugerirImobiliariaPorNome,
  type ImobiliariaParaRepasse,
} from "@/lib/repassesIdentificacao";

const BUCKET_TEMP = "faturas-temp";
const BUCKET_FINAL = "repasses";

// Mesmo cuidado de tempo que faturas/upload/actions.ts -- corta a chamada à
// IA um pouco antes do maxDuration da página (60s), com folga pro catch
// ainda devolver um resultado tratado em vez da Vercel matar a função.
const LIMITE_TEMPO_IA_MS = 50_000;

function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`A identificação demorou mais que ${Math.round(ms / 1000)}s.`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export type ResultadoProcessamentoRepasse = {
  ok: boolean;
  nomeArquivo: string;
  mensagem: string;
  status?: string;
};

// Upload em lote de relatório de repasse + comprovante de pagamento -- o
// arquivo em si sobe direto do navegador pro bucket temporário (mesmo
// motivo de faturas/upload: corpo de Server Action tem teto de ~4,5 MB na
// Vercel), essa action só recebe o caminho.
export async function processarRepasseUpload(formData: FormData): Promise<ResultadoProcessamentoRepasse> {
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
  const { data: duplicataArquivo } = await supabase
    .from("repasses")
    .select("id")
    .eq("arquivo_hash", hash)
    .maybeSingle();

  const resultadoLeitura = await abrirTextoPdfComSenha(buffer, []);
  const texto = resultadoLeitura?.texto ?? null;

  const pathFinal = `${competencia}/${crypto.randomUUID()}.pdf`;
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_FINAL)
    .upload(pathFinal, buffer, { contentType: "application/pdf" });
  if (erroUpload) {
    return { ok: false, nomeArquivo, mensagem: `Falha ao salvar o arquivo: ${erroUpload.message}` };
  }

  const historico = [{ usuario: user.email, data: new Date().toISOString(), acao: "upload", detalhe: nomeArquivo }];

  if (!texto) {
    const { error } = await supabase.from("repasses").insert({
      competencia,
      arquivo_bucket_path: pathFinal,
      arquivo_nome: nomeArquivo,
      arquivo_hash: hash,
      status: duplicataArquivo ? "duplicada" : "aguardando_conferencia",
      possivel_duplicidade_de: duplicataArquivo?.id ?? null,
      confianca: null,
      historico_identificacao: historico,
      criado_por: user.id,
      criado_por_email: user.email,
    });
    if (error) return { ok: false, nomeArquivo, mensagem: error.message };
    return {
      ok: true,
      nomeArquivo,
      status: duplicataArquivo ? "duplicada" : "aguardando_conferencia",
      mensagem: "Não conseguimos abrir esse PDF — precisa de conferência manual.",
    };
  }

  let dadosIA = null;
  try {
    dadosIA = await comLimiteDeTempo(extrairDadosRepasse(texto, { nomeArquivo }), LIMITE_TEMPO_IA_MS);
  } catch (e) {
    console.error("[repasses] erro ao extrair dados por IA:", e);
  }

  const { data: imobiliariasData } = await supabase
    .from("imobiliarias")
    .select("id, nome, cnpj, codigo_produtor_corp");
  const imobiliarias = (imobiliariasData ?? []) as ImobiliariaParaRepasse[];

  // Prioridade: código do produtor no Corp (exato, sem ambiguidade) > CPF/CNPJ
  // de quem recebeu (só no comprovante) > nome (menos confiável, pode ter
  // homônimo).
  let resultadoIdent = buscarImobiliariaPorCodigoProdutor(dadosIA?.codigo_produtor_corp ?? null, imobiliarias);
  if (!resultadoIdent.imobiliaria_id) {
    resultadoIdent = buscarImobiliariaPorCpfCnpj(dadosIA?.cpf_cnpj_produtor ?? null, imobiliarias);
  }
  if (!resultadoIdent.imobiliaria_id && dadosIA?.nome_produtor) {
    resultadoIdent = sugerirImobiliariaPorNome(dadosIA.nome_produtor, imobiliarias);
  }

  const imobiliariaId = resultadoIdent.imobiliaria_id;
  const nomeIdentificado = imobiliariaId ? imobiliarias.find((i) => i.id === imobiliariaId)?.nome ?? null : null;
  const tipoDocumento = dadosIA?.tipo_documento ?? null;
  const tipoDocumentoReconhecido = tipoDocumento === "relatorio" || tipoDocumento === "comprovante";
  const confianca = imobiliariaId ? resultadoIdent.confianca : null;
  const confiancaSuficiente = confianca === "alta" || confianca === "media";

  // Duplicidade por conteúdo: já existe um repasse "vivo" (identificado ou
  // enviado) dessa mesma imobiliária + competência + tipo de documento --
  // evita o mesmo relatório/comprovante entrar 2x com nomes de arquivo
  // diferentes.
  let duplicataConteudo: { id: string } | null = null;
  if (!duplicataArquivo && imobiliariaId && tipoDocumentoReconhecido) {
    const { data } = await supabase
      .from("repasses")
      .select("id")
      .eq("imobiliaria_id", imobiliariaId)
      .eq("competencia", competencia)
      .eq("tipo_documento", tipoDocumento)
      .in("status", ["identificado", "enviada"])
      .maybeSingle();
    duplicataConteudo = data;
  }
  const duplicataFinal = duplicataArquivo ?? duplicataConteudo;

  const status = duplicataFinal
    ? "duplicada"
    : !imobiliariaId
      ? "aguardando_identificacao"
      : confiancaSuficiente && tipoDocumentoReconhecido
        ? "identificado"
        : "aguardando_conferencia";

  const { error } = await supabase.from("repasses").insert({
    competencia,
    arquivo_bucket_path: pathFinal,
    arquivo_nome: nomeArquivo,
    arquivo_hash: hash,
    imobiliaria_id: imobiliariaId,
    tipo_documento: tipoDocumento,
    valor: dadosIA?.valor ?? null,
    data_pagamento: dadosIA?.data_pagamento ?? null,
    codigo_produtor_corp: dadosIA?.codigo_produtor_corp ?? null,
    confianca,
    status,
    possivel_duplicidade_de: duplicataFinal?.id ?? null,
    texto_bruto_extraido: texto || null,
    historico_identificacao: historico,
    criado_por: user.id,
    criado_por_email: user.email,
  });
  if (error) return { ok: false, nomeArquivo, mensagem: error.message };

  const tipoTexto = tipoDocumento ? ` (${tipoDocumento})` : "";
  const mensagens: Record<string, string> = {
    duplicada: duplicataConteudo
      ? "Já existe um repasse vivo dessa imobiliária/competência desse mesmo tipo — marcado como duplicata pra conferência."
      : "Parece duplicada de um arquivo já enviado.",
    aguardando_identificacao: `Aberto${tipoTexto}, mas não identificamos a imobiliária — precisa de conferência.`,
    aguardando_conferencia: `Aberto${tipoTexto}, sugestão: ${nomeIdentificado ?? "?"} — confirme na tela principal.`,
    identificado: `Identificado: ${nomeIdentificado}${tipoTexto}.`,
  };

  return { ok: true, nomeArquivo, status, mensagem: mensagens[status] ?? "Processado." };
}
