"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { resolverOuCriarImobiliaria } from "@/lib/faturasIdentificacao";

async function checarAcesso() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return supabase;
}

// Adiciona uma imobiliária nova (ou atualiza uma existente pelo CNPJ),
// habilitando de uma vez todas as seguradoras marcadas no formulário — um
// campo único pra imobiliária, em vez de repetir o cadastro aba por aba.
export async function adicionarEsperada(formData: FormData) {
  const supabase = await checarAcesso();

  const nome = String(formData.get("nome") ?? "").trim();
  const cnpj = String(formData.get("cnpj") ?? "").trim();
  const seguradorasSelecionadas = formData.getAll("seguradoras").map(String).filter(Boolean);
  const voltarPara = String(formData.get("voltar_para") ?? "").trim();

  if (!nome || !cnpj || !seguradorasSelecionadas.length) {
    redirect(
      `/faturas?erro=${encodeURIComponent("Informe nome, CNPJ e marque ao menos uma seguradora.")}${voltarPara}`
    );
  }

  let imobiliariaId: string;
  try {
    imobiliariaId = await resolverOuCriarImobiliaria(supabase, nome, cnpj);
  } catch (e) {
    redirect(
      `/faturas?erro=${encodeURIComponent(e instanceof Error ? e.message : "Falha ao registrar imobiliária.")}${voltarPara}`
    );
  }

  const linhas = seguradorasSelecionadas.map((seguradora) => ({
    imobiliaria_id: imobiliariaId,
    seguradora,
    codigo_produtor: "",
    ativo: true,
  }));
  const { error } = await supabase
    .from("faturas_esperadas")
    .upsert(linhas, { onConflict: "imobiliaria_id, seguradora, codigo_produtor" });
  if (error) {
    redirect(`/faturas?erro=${encodeURIComponent(error.message)}${voltarPara}`);
  }

  redirect(`/faturas?ok=${encodeURIComponent("Imobiliária salva.")}${voltarPara}`);
}

// Único lugar onde vencimento/CNPJ da O2/observação/ativo de uma
// imobiliária podem ser alterados — a tela principal de Faturas é só
// leitura, tudo passa por aqui (botão "Editar" por imobiliária).
export async function salvarSeguradorasImobiliaria(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const qtd = Number(formData.get("qtd") ?? 0);
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);

  for (let i = 0; i < qtd; i++) {
    const seguradora = String(formData.get(`seguradora_${i}`) ?? "").trim();
    if (!seguradora) continue;
    const ativo = formData.get(`ativo_${i}`) === "on";
    const diaVencimento = String(formData.get(`dia_vencimento_${i}`) ?? "").trim();
    const cnpjO2 = String(formData.get(`cnpj_o2_${i}`) ?? "").trim();
    const observacao = String(formData.get(`observacao_${i}`) ?? "").trim();

    await supabase.from("faturas_esperadas").upsert(
      {
        imobiliaria_id: imobiliariaId,
        seguradora,
        codigo_produtor: "",
        ativo,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
        cnpj_o2: cnpjO2 || null,
        observacao: observacao || null,
      },
      { onConflict: "imobiliaria_id, seguradora, codigo_produtor" }
    );
  }

  redirect(`/faturas/imobiliaria/${imobiliariaId}?ok=${encodeURIComponent("Dados salvos.")}`);
}

// E-mail pra onde as faturas dessa imobiliária serão enviadas — separado
// do e-mail de login dela (esse aqui é só pro fluxo de Faturas).
export async function atualizarEmailFaturas(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const email = String(formData.get("email_faturas") ?? "").trim();
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);

  const { error } = await supabase
    .from("imobiliarias")
    .update({ email_faturas: email || null })
    .eq("id", imobiliariaId);
  if (error) {
    redirect(`/faturas/imobiliaria/${imobiliariaId}?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`/faturas/imobiliaria/${imobiliariaId}?ok=${encodeURIComponent("E-mail salvo.")}`);
}

// Vincula um registro provisório (nome_provisorio, sem CNPJ conhecido) a
// um registro de verdade em imobiliarias, assim que alguém descobre/digita
// o CNPJ.
export async function vincularCnpjProvisoria(formData: FormData) {
  const supabase = await checarAcesso();

  const id = String(formData.get("id") ?? "");
  const cnpj = String(formData.get("cnpj") ?? "").trim();
  const seguradora = String(formData.get("seguradora") ?? "").trim();
  if (!id || !cnpj) redirect(`/faturas?erro=${encodeURIComponent("Informe o CNPJ.")}&seguradora=${encodeURIComponent(seguradora)}`);

  const { data: esperada } = await supabase.from("faturas_esperadas").select("nome_provisorio").eq("id", id).single();
  if (!esperada?.nome_provisorio) {
    redirect(`/faturas?erro=${encodeURIComponent("Registro inválido.")}&seguradora=${encodeURIComponent(seguradora)}`);
  }

  let imobiliariaId: string;
  try {
    imobiliariaId = await resolverOuCriarImobiliaria(supabase, esperada.nome_provisorio, cnpj);
  } catch (e) {
    redirect(
      `/faturas?erro=${encodeURIComponent(e instanceof Error ? e.message : "Falha ao registrar imobiliária.")}&seguradora=${encodeURIComponent(seguradora)}`
    );
  }

  const { error } = await supabase
    .from("faturas_esperadas")
    .update({ imobiliaria_id: imobiliariaId, nome_provisorio: null })
    .eq("id", id);
  if (error) redirect(`/faturas?erro=${encodeURIComponent(error.message)}&seguradora=${encodeURIComponent(seguradora)}`);

  redirect(`/faturas?ok=${encodeURIComponent("CNPJ vinculado.")}&seguradora=${encodeURIComponent(seguradora)}`);
}
