"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { abrirTextoPdfComSenha, apenasDigitos } from "@/lib/pdfComSenha";
import { extrairDadosFatura } from "@/lib/faturasIA";

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
        { imobiliaria_id: imobiliariaId, seguradora: fatura.seguradora, codigo_produtor: fatura.codigo_produtor ?? null, ativo: true },
        { onConflict: "imobiliaria_id, seguradora, codigo_produtor" }
      );
  }

  redirect(`/faturas/conferencia?ok=${encodeURIComponent("Identificação confirmada.")}`);
}

// Usado quando o PDF nunca abriu (nenhum CNPJ cadastrado bateu) — tenta de
// novo com o CNPJ informado manualmente, e se abrir já processa a fatura.
export async function tentarReabrirComCnpj(formData: FormData) {
  const { supabase, user } = await checarAcesso();

  const faturaId = String(formData.get("fatura_id") ?? "");
  const cnpjDigitado = apenasDigitos(String(formData.get("cnpj") ?? ""));
  if (!faturaId || !cnpjDigitado) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Informe um CNPJ.")}`);
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

  const resultado = await abrirTextoPdfComSenha(buffer, [cnpjDigitado]);
  if (!resultado) {
    redirect(`/faturas/conferencia?erro=${encodeURIComponent("Esse CNPJ não abriu o arquivo. Confira o número.")}`);
  }

  const { data: imobiliariaEncontrada } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("cnpj", cnpjDigitado)
    .maybeSingle();
  // CNPJ pode estar salvo formatado — tenta também comparando só dígitos.
  let imobiliariaId = imobiliariaEncontrada?.id ?? null;
  if (!imobiliariaId) {
    const { data: todas } = await supabase.from("imobiliarias").select("id, cnpj");
    imobiliariaId = todas?.find((i) => i.cnpj && apenasDigitos(i.cnpj) === cnpjDigitado)?.id ?? null;
  }

  let dadosIA = null;
  try {
    dadosIA = await extrairDadosFatura(resultado.texto);
  } catch (e) {
    console.error("[faturas] erro ao extrair dados por IA (reabertura):", e);
  }

  const historico = [
    ...(fatura.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "reabertura_manual_cnpj", detalhe: cnpjDigitado },
  ];

  const { error } = await supabase
    .from("faturas")
    .update({
      imobiliaria_id: imobiliariaId,
      seguradora: dadosIA?.seguradora ?? null,
      codigo_produtor: dadosIA?.codigo_produtor ?? null,
      vencimento: dadosIA?.vencimento ?? null,
      valor: dadosIA?.valor ?? null,
      numero_documento: dadosIA?.numero_documento ?? null,
      texto_bruto_extraido: resultado.texto,
      confianca: imobiliariaId ? "alta" : null,
      status: imobiliariaId ? "fatura_carregada" : "aguardando_identificacao",
      historico_identificacao: historico,
    })
    .eq("id", faturaId);
  if (error) redirect(`/faturas/conferencia?erro=${encodeURIComponent(error.message)}`);

  redirect(`/faturas/conferencia?ok=${encodeURIComponent("Arquivo aberto e processado.")}`);
}
