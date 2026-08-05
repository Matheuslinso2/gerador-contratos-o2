"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { abrirTextoPdfComSenha } from "@/lib/pdfComSenha";
import { extrairDadosFatura } from "@/lib/faturasIA";
import {
  buscarImobiliariaPorCnpjNoTexto,
  sugerirImobiliariaPorTexto,
  resolverOuCriarImobiliaria,
  normalizarSeguradora,
  SEGURADORAS_CANONICAS,
  type ImobiliariaBasica,
} from "@/lib/faturasIdentificacao";

const BUCKET_FINAL = "faturas";

async function checarAcesso() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return { supabase, user };
}

// Confirma (ou corrige) manualmente qual imobiliária é dona da fatura.
// Também "ensina" faturas_esperadas — a combinação vira esperada dali pra
// frente, pra próxima competência já vir com identificação automática.
export async function confirmarIdentificacao(formData: FormData) {
  const { supabase, user } = await checarAcesso();

  const faturaId = String(formData.get("fatura_id") ?? "");
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  if (!faturaId || !imobiliariaId) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Selecione uma imobiliária.")}`);
  }

  const { data: fatura } = await supabase
    .from("faturas")
    .select("historico_identificacao, seguradora, codigo_produtor")
    .eq("id", faturaId)
    .single();

  const historico = [
    ...(fatura?.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "confirmacao_manual", detalhe: imobiliariaId },
  ];

  const { error } = await supabase
    .from("faturas")
    .update({
      imobiliaria_id: imobiliariaId,
      confianca: "alta",
      status: "fatura_carregada",
      historico_identificacao: historico,
    })
    .eq("id", faturaId);
  if (error) redirect(`/faturas/conferencia?erro=${encodeURIComponent(error.message)}`);

  if (fatura?.seguradora) {
    await supabase
      .from("faturas_esperadas")
      .upsert(
        { imobiliaria_id: imobiliariaId, seguradora: fatura.seguradora, codigo_produtor: fatura.codigo_produtor ?? "", ativo: true },
        { onConflict: "imobiliaria_id, seguradora" }
      );
  }

  redirect(`/faturas/conferencia?ok=${encodeURIComponent("Identificação confirmada.")}`);
}

// Reprocessa a identificação de uma fatura que já tem texto extraído
// (não precisa baixar/decriptar o PDF de novo) — útil pra faturas que
// ficaram com resultado antigo de antes de algum ajuste na extração/
// identificação, sem precisar reenviar o arquivo (o que cairia como
// duplicada pelo hash).
export async function reprocessarIdentificacao(formData: FormData) {
  const { supabase, user } = await checarAcesso();

  const faturaId = String(formData.get("fatura_id") ?? "");
  if (!faturaId) redirect(`/faturas/conferencia?erro=${encodeURIComponent("Fatura inválida.")}`);

  const { data: fatura } = await supabase
    .from("faturas")
    .select("texto_bruto_extraido, historico_identificacao")
    .eq("id", faturaId)
    .single();
  if (!fatura?.texto_bruto_extraido) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Essa fatura ainda não tem texto extraído.")}`);
  }

  let dadosIA = null;
  try {
    dadosIA = await extrairDadosFatura(fatura.texto_bruto_extraido);
  } catch (e) {
    console.error("[faturas] erro ao extrair dados por IA (reprocessamento):", e);
  }

  const { data: conhecidasData } = await supabase.from("imobiliarias_conhecidas").select("id, nome, cnpj");
  const conhecidas = (conhecidasData ?? []) as ImobiliariaBasica[];

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
  const seguradoraNormalizada = normalizarSeguradora(dadosIA?.seguradora ?? null);
  const seguradoraReconhecida = seguradoraNormalizada ? SEGURADORAS_CANONICAS.includes(seguradoraNormalizada) : false;

  const historico = [
    ...(fatura.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "reprocessamento", detalhe: "" },
  ];

  const { error } = await supabase
    .from("faturas")
    .update({
      imobiliaria_id: imobiliariaId,
      seguradora: seguradoraNormalizada,
      codigo_produtor: dadosIA?.codigo_produtor ?? null,
      vencimento: dadosIA?.vencimento ?? null,
      valor: dadosIA?.valor ?? null,
      numero_documento: dadosIA?.numero_documento ?? null,
      confianca,
      status: imobiliariaId ? (confianca === "alta" && seguradoraReconhecida ? "fatura_carregada" : "aguardando_conferencia") : "aguardando_identificacao",
      historico_identificacao: historico,
    })
    .eq("id", faturaId);
  if (error) redirect(`/faturas/conferencia?erro=${encodeURIComponent(error.message)}`);

  redirect(`/faturas/conferencia?ok=${encodeURIComponent("Reprocessado.")}`);
}

// Usado quando o PDF nunca abriu com os CNPJs da O2 — tenta de novo com uma
// senha informada manualmente (não necessariamente um CNPJ; algumas
// seguradoras podem ter um padrão diferente). Se abrir, roda a mesma
// identificação por conteúdo usada no upload normal.
export async function tentarReabrirComSenha(formData: FormData) {
  const { supabase, user } = await checarAcesso();

  const faturaId = String(formData.get("fatura_id") ?? "");
  const senhaDigitada = String(formData.get("senha") ?? "").trim();
  if (!faturaId || !senhaDigitada) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Informe uma senha.")}`);
  }

  const { data: fatura } = await supabase
    .from("faturas")
    .select("arquivo_bucket_path, historico_identificacao")
    .eq("id", faturaId)
    .single();
  if (!fatura) redirect(`/faturas/conferencia?erro=${encodeURIComponent("Fatura não encontrada.")}`);

  const { data: baixado, error: erroDownload } = await supabase.storage
    .from(BUCKET_FINAL)
    .download(fatura.arquivo_bucket_path);
  if (erroDownload || !baixado) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Não foi possível recuperar o arquivo.")}`);
  }
  const buffer = Buffer.from(await baixado.arrayBuffer());

  const resultado = await abrirTextoPdfComSenha(buffer, [{ chave: "manual", senha: senhaDigitada }]);
  if (!resultado) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Essa senha não abriu o arquivo.")}`);
  }

  let dadosIA = null;
  try {
    dadosIA = await extrairDadosFatura(resultado.texto);
  } catch (e) {
    console.error("[faturas] erro ao extrair dados por IA (reabertura):", e);
  }

  const { data: conhecidasData } = await supabase.from("imobiliarias_conhecidas").select("id, nome, cnpj");
  const conhecidas = (conhecidasData ?? []) as ImobiliariaBasica[];

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
  const seguradoraNormalizada = normalizarSeguradora(dadosIA?.seguradora ?? null);
  const seguradoraReconhecida = seguradoraNormalizada ? SEGURADORAS_CANONICAS.includes(seguradoraNormalizada) : false;

  const historico = [
    ...(fatura.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "reabertura_manual_senha", detalhe: "" },
  ];

  const { error } = await supabase
    .from("faturas")
    .update({
      imobiliaria_id: imobiliariaId,
      seguradora: seguradoraNormalizada,
      codigo_produtor: dadosIA?.codigo_produtor ?? null,
      vencimento: dadosIA?.vencimento ?? null,
      valor: dadosIA?.valor ?? null,
      numero_documento: dadosIA?.numero_documento ?? null,
      texto_bruto_extraido: resultado.texto,
      confianca,
      status: imobiliariaId ? (confianca === "alta" && seguradoraReconhecida ? "fatura_carregada" : "aguardando_conferencia") : "aguardando_identificacao",
      historico_identificacao: historico,
    })
    .eq("id", faturaId);
  if (error) redirect(`/faturas/conferencia?erro=${encodeURIComponent(error.message)}`);

  redirect(`/faturas/conferencia?ok=${encodeURIComponent("Arquivo aberto e processado.")}`);
}

// Resolve uma fatura marcada como possível duplicata (mesma
// imobiliária+seguradora+competência de uma fatura já viva, ou mesmo
// arquivo). "Manter" confirma que é lixo e arquiva (cancelada, some da
// tela). "Substituir" assume que essa é a válida (ex: reemissão com valor
// corrigido) -- recalcula o status normal dela e arquiva a antiga.
export async function resolverDuplicata(formData: FormData) {
  const { supabase, user } = await checarAcesso();

  const faturaId = String(formData.get("fatura_id") ?? "");
  const acao = String(formData.get("acao") ?? "");
  if (!faturaId || !["manter", "substituir"].includes(acao)) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Ação inválida.")}`);
  }

  const { data: fatura } = await supabase
    .from("faturas")
    .select("imobiliaria_id, confianca, seguradora, possivel_duplicidade_de, historico_identificacao")
    .eq("id", faturaId)
    .single();
  if (!fatura) redirect(`/faturas/conferencia?erro=${encodeURIComponent("Fatura não encontrada.")}`);

  const historico = [
    ...(fatura!.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: `duplicata_${acao}`, detalhe: "" },
  ];

  if (acao === "manter") {
    const { error } = await supabase
      .from("faturas")
      .update({ status: "cancelada", historico_identificacao: historico })
      .eq("id", faturaId);
    if (error) redirect(`/faturas/conferencia?erro=${encodeURIComponent(error.message)}`);
    redirect(`/faturas/conferencia?ok=${encodeURIComponent("Marcada como duplicata e arquivada.")}`);
  }

  const seguradoraReconhecida = fatura!.seguradora ? SEGURADORAS_CANONICAS.includes(fatura!.seguradora) : false;
  const statusNovo = !fatura!.imobiliaria_id
    ? "aguardando_identificacao"
    : fatura!.confianca === "alta" && seguradoraReconhecida
      ? "fatura_carregada"
      : "aguardando_conferencia";

  const { error: erroUpdate } = await supabase
    .from("faturas")
    .update({ status: statusNovo, historico_identificacao: historico })
    .eq("id", faturaId);
  if (erroUpdate) redirect(`/faturas/conferencia?erro=${encodeURIComponent(erroUpdate.message)}`);

  if (fatura!.possivel_duplicidade_de) {
    await supabase.from("faturas").update({ status: "cancelada" }).eq("id", fatura!.possivel_duplicidade_de);
  }

  redirect(`/faturas/conferencia?ok=${encodeURIComponent("Processada normalmente; a fatura anterior foi arquivada.")}`);
}
