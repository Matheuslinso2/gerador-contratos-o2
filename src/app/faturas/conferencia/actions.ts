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
  origensAtivasDaImobiliaria,
  nomeCandidatoDoArquivo,
  SEGURADORAS_CANONICAS,
  type ImobiliariaBasica,
} from "@/lib/faturasIdentificacao";

const BUCKET_FINAL = "faturas";

const STATUS_ATIVOS = ["aguardando_identificacao", "aguardando_conferencia", "aguardando_origem", "fatura_carregada", "pronta_para_envio", "enviada"];

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

  // O documento (ex: um relatório em CSV/planilha que só lista segurado e
  // prêmio, sem mencionar a seguradora em lugar nenhum) pode não ter
  // seguradora alguma extraída pela IA -- nesse caso pede pra escolher
  // aqui mesmo, na confirmação manual (ver campo condicional na tela).
  // Sem isso, a fatura virava "pronta pra envio" com seguradora nula --
  // some da lista principal (que agrupa por imobiliária+seguradora) sem
  // nenhum aviso, só o boleto ficava visível, nunca o demonstrativo.
  const seguradoraForm = String(formData.get("seguradora") ?? "").trim();
  const seguradora = fatura?.seguradora || seguradoraForm || null;
  if (!seguradora) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Esse documento não tem seguradora identificada — selecione uma antes de confirmar.")}`);
  }

  const historico = [
    ...(fatura?.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "confirmacao_manual", detalhe: imobiliariaId },
  ];

  // Sem isso a fatura ficava com origem null pra sempre -- a confirmação
  // manual nunca perguntava/resolvia isso (diferente do upload normal),
  // e a tela principal casa fatura com vínculo por imobiliária+origem
  // EXATOS, então ficava "confirmada" no banco mas invisível lá (achado
  // real: a DAHER FERES SOBRINHO, com 1 única origem -- SegImob -- ficou
  // sem vincular depois de confirmada manualmente).
  const origensPossiveis = await origensAtivasDaImobiliaria(supabase, imobiliariaId, seguradora);
  const precisaEscolherOrigem = origensPossiveis.length > 1;
  const origemFatura = origensPossiveis.length === 1 ? origensPossiveis[0] : null;

  const { error } = await supabase
    .from("faturas")
    .update({
      imobiliaria_id: imobiliariaId,
      seguradora,
      origem: origemFatura,
      confianca: "alta",
      status: precisaEscolherOrigem ? "aguardando_origem" : "fatura_carregada",
      historico_identificacao: historico,
    })
    .eq("id", faturaId);
  if (error) redirect(`/faturas/conferencia?erro=${encodeURIComponent(error.message)}`);

  await supabase.from("faturas_esperadas").upsert(
    {
      imobiliaria_id: imobiliariaId,
      seguradora,
      cnpj_o2: origemFatura ?? "",
      codigo_produtor: fatura?.codigo_produtor ?? "",
      ativo: true,
    },
    { onConflict: "imobiliaria_id, seguradora, cnpj_o2" }
  );

  redirect(
    `/faturas/conferencia?ok=${encodeURIComponent(
      precisaEscolherOrigem
        ? "Identificação confirmada -- essa imobiliária tem mais de uma origem, escolha qual na lista."
        : "Identificação confirmada."
    )}`
  );
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
    .select("texto_bruto_extraido, historico_identificacao, arquivo_nome, seguradora")
    .eq("id", faturaId)
    .single();
  if (!fatura?.texto_bruto_extraido) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Essa fatura ainda não tem texto extraído.")}`);
  }

  let dadosIA = null;
  try {
    dadosIA = await extrairDadosFatura(fatura.texto_bruto_extraido, {
      seguradora: fatura.seguradora ?? null,
      nomeArquivo: fatura.arquivo_nome ?? null,
    });
  } catch (e) {
    console.error("[faturas] erro ao extrair dados por IA (reprocessamento):", e);
  }

  const { data: conhecidasData } = await supabase.from("imobiliarias_conhecidas").select("id, nome, cnpj");
  const conhecidas = (conhecidasData ?? []) as ImobiliariaBasica[];

  let resultadoIdent = buscarImobiliariaPorCnpjNoTexto(dadosIA?.cnpj_tomador ?? null, conhecidas);
  if (!resultadoIdent.imobiliaria_id && dadosIA?.identificacao_texto) {
    resultadoIdent = sugerirImobiliariaPorTexto(dadosIA.identificacao_texto, conhecidas);
  }
  if (!resultadoIdent.imobiliaria_id) {
    const candidatoArquivo = nomeCandidatoDoArquivo(fatura?.arquivo_nome);
    if (candidatoArquivo) resultadoIdent = sugerirImobiliariaPorTexto(candidatoArquivo, conhecidas);
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
  const tipoDocumentoReconhecido = dadosIA?.tipo_documento === "boleto" || dadosIA?.tipo_documento === "demonstrativo";

  let origensPossiveis: string[] = [];
  if (imobiliariaId && seguradoraNormalizada) {
    origensPossiveis = await origensAtivasDaImobiliaria(supabase, imobiliariaId, seguradoraNormalizada);
  }
  const precisaEscolherOrigem = origensPossiveis.length > 1;
  const origemFatura = origensPossiveis.length === 1 ? origensPossiveis[0] : null;

  const historico = [
    ...(fatura.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "reprocessamento", detalhe: "" },
  ];

  const { error } = await supabase
    .from("faturas")
    .update({
      imobiliaria_id: imobiliariaId,
      seguradora: seguradoraNormalizada,
      origem: origemFatura,
      tipo_documento: dadosIA?.tipo_documento ?? null,
      codigo_produtor: dadosIA?.codigo_produtor ?? null,
      vencimento: dadosIA?.vencimento ?? null,
      valor: dadosIA?.valor ?? null,
      numero_documento: dadosIA?.numero_documento ?? null,
      confianca,
      status: !imobiliariaId
        ? "aguardando_identificacao"
        : precisaEscolherOrigem
          ? "aguardando_origem"
          : confianca === "alta" && seguradoraReconhecida && tipoDocumentoReconhecido
            ? "fatura_carregada"
            : "aguardando_conferencia",
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
    .select("arquivo_bucket_path, historico_identificacao, arquivo_nome, seguradora")
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

  const resultado = await abrirTextoPdfComSenha(buffer, [{ chave: senhaDigitada, senha: senhaDigitada }]);
  if (!resultado) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Essa senha não abriu o arquivo.")}`);
  }

  let dadosIA = null;
  try {
    dadosIA = await extrairDadosFatura(resultado.texto, {
      seguradora: fatura.seguradora ?? null,
      nomeArquivo: fatura.arquivo_nome ?? null,
    });
  } catch (e) {
    console.error("[faturas] erro ao extrair dados por IA (reabertura):", e);
  }

  const { data: conhecidasData } = await supabase.from("imobiliarias_conhecidas").select("id, nome, cnpj");
  const conhecidas = (conhecidasData ?? []) as ImobiliariaBasica[];

  let resultadoIdent = buscarImobiliariaPorCnpjNoTexto(dadosIA?.cnpj_tomador ?? null, conhecidas);
  if (!resultadoIdent.imobiliaria_id && dadosIA?.identificacao_texto) {
    resultadoIdent = sugerirImobiliariaPorTexto(dadosIA.identificacao_texto, conhecidas);
  }
  if (!resultadoIdent.imobiliaria_id) {
    const candidatoArquivo = nomeCandidatoDoArquivo(fatura?.arquivo_nome);
    if (candidatoArquivo) resultadoIdent = sugerirImobiliariaPorTexto(candidatoArquivo, conhecidas);
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
  const tipoDocumentoReconhecido = dadosIA?.tipo_documento === "boleto" || dadosIA?.tipo_documento === "demonstrativo";

  let origensPossiveis: string[] = [];
  if (imobiliariaId && seguradoraNormalizada) {
    origensPossiveis = await origensAtivasDaImobiliaria(supabase, imobiliariaId, seguradoraNormalizada);
  }
  const precisaEscolherOrigem = origensPossiveis.length > 1;
  const origemFatura = origensPossiveis.length === 1 ? origensPossiveis[0] : null;

  const historico = [
    ...(fatura.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "reabertura_manual_senha", detalhe: "" },
  ];

  const { error } = await supabase
    .from("faturas")
    .update({
      imobiliaria_id: imobiliariaId,
      seguradora: seguradoraNormalizada,
      origem: origemFatura,
      tipo_documento: dadosIA?.tipo_documento ?? null,
      senha_pdf: senhaDigitada,
      codigo_produtor: dadosIA?.codigo_produtor ?? null,
      vencimento: dadosIA?.vencimento ?? null,
      valor: dadosIA?.valor ?? null,
      numero_documento: dadosIA?.numero_documento ?? null,
      texto_bruto_extraido: resultado.texto,
      confianca,
      status: !imobiliariaId
        ? "aguardando_identificacao"
        : precisaEscolherOrigem
          ? "aguardando_origem"
          : confianca === "alta" && seguradoraReconhecida && tipoDocumentoReconhecido
            ? "fatura_carregada"
            : "aguardando_conferencia",
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

// Resolve a pergunta "qual origem" de uma fatura que ficou em
// aguardando_origem -- a imobiliária tem mais de 1 relação ativa com essa
// seguradora (ex: O2 Seguros, O2 Capitalização, SegImob) e não dá pra
// saber pelo conteúdo do arquivo qual delas essa fatura é.
export async function escolherOrigemFatura(formData: FormData) {
  const { supabase, user } = await checarAcesso();

  const faturaId = String(formData.get("fatura_id") ?? "");
  const origem = String(formData.get("origem") ?? "").trim();
  if (!faturaId || !origem) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Selecione a origem.")}`);
  }

  const { data: fatura } = await supabase
    .from("faturas")
    .select("imobiliaria_id, seguradora, competencia, confianca, tipo_documento, historico_identificacao")
    .eq("id", faturaId)
    .single();
  if (!fatura) redirect(`/faturas/conferencia?erro=${encodeURIComponent("Fatura não encontrada.")}`);

  // Só agora, com a origem conhecida, dá pra checar duplicidade de verdade
  // -- outra fatura viva da mesma imobiliária+seguradora+competência+
  // origem+tipo de documento.
  let consulta = supabase
    .from("faturas")
    .select("id")
    .eq("imobiliaria_id", fatura!.imobiliaria_id)
    .eq("seguradora", fatura!.seguradora)
    .eq("competencia", fatura!.competencia)
    .eq("origem", origem)
    .neq("id", faturaId)
    .in("status", STATUS_ATIVOS);
  consulta = fatura!.tipo_documento ? consulta.eq("tipo_documento", fatura!.tipo_documento) : consulta.is("tipo_documento", null);
  const { data: duplicataConteudo } = await consulta.maybeSingle();

  const seguradoraReconhecida = fatura!.seguradora ? SEGURADORAS_CANONICAS.includes(fatura!.seguradora) : false;
  const tipoDocumentoReconhecido = fatura!.tipo_documento === "boleto" || fatura!.tipo_documento === "demonstrativo";

  const status = duplicataConteudo
    ? "duplicada"
    : fatura!.confianca === "alta" && seguradoraReconhecida && tipoDocumentoReconhecido
      ? "fatura_carregada"
      : "aguardando_conferencia";

  const historico = [
    ...(fatura!.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "origem_escolhida", detalhe: origem },
  ];

  const { error } = await supabase
    .from("faturas")
    .update({ origem, status, possivel_duplicidade_de: duplicataConteudo?.id ?? null, historico_identificacao: historico })
    .eq("id", faturaId);
  if (error) redirect(`/faturas/conferencia?erro=${encodeURIComponent(error.message)}`);

  redirect(`/faturas/conferencia?ok=${encodeURIComponent("Origem confirmada.")}`);
}
