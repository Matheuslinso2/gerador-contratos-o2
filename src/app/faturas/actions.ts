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
  const diaVencimento = String(formData.get("dia_vencimento") ?? "").trim();
  const emailFaturas = String(formData.get("email_faturas") ?? "").trim();
  const seguradorasSelecionadas = formData.getAll("seguradoras").map(String).filter(Boolean);
  const voltarPara = String(formData.get("voltar_para") ?? "").trim();

  if (!nome || !cnpj || !diaVencimento || !seguradorasSelecionadas.length) {
    redirect(
      `/faturas?erro=${encodeURIComponent("Informe nome, CNPJ, dia de vencimento e marque ao menos uma seguradora.")}${voltarPara}`
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

  if (emailFaturas) {
    await supabase.from("imobiliarias").update({ email_faturas: emailFaturas }).eq("id", imobiliariaId);
  }

  const linhas = seguradorasSelecionadas.map((seguradora) => ({
    imobiliaria_id: imobiliariaId,
    seguradora,
    ativo: true,
    dia_vencimento: Number(diaVencimento),
  }));
  const { error } = await supabase
    .from("faturas_esperadas")
    .upsert(linhas, { onConflict: "imobiliaria_id, seguradora, cnpj_o2" });
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
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || `/faturas/imobiliaria/${imobiliariaId}`;
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);

  for (let i = 0; i < qtd; i++) {
    const seguradora = String(formData.get(`seguradora_${i}`) ?? "").trim();
    if (!seguradora) continue;
    const ativo = formData.get(`ativo_${i}`) === "on";
    const diaVencimento = String(formData.get(`dia_vencimento_${i}`) ?? "").trim();
    const cnpjO2 = String(formData.get(`cnpj_o2_${i}`) ?? "").trim();
    const observacao = String(formData.get(`observacao_${i}`) ?? "").trim();

    // Linha extra em branco (pra dar espaço de adicionar uma 2ª origem na
    // mesma seguradora) que ninguém preencheu -- não grava nada, senão
    // acumula lixo toda vez que a tela é salva.
    if (!ativo && !diaVencimento && !cnpjO2 && !observacao) continue;

    await supabase.from("faturas_esperadas").upsert(
      {
        imobiliaria_id: imobiliariaId,
        seguradora,
        ativo,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
        cnpj_o2: cnpjO2,
        observacao: observacao || null,
      },
      { onConflict: "imobiliaria_id, seguradora, cnpj_o2" }
    );
  }

  redirect(`${voltarPara}?ok=${encodeURIComponent("Dados salvos.")}`);
}

// E-mail pra onde as faturas dessa imobiliária serão enviadas — separado
// do e-mail de login dela (esse aqui é só pro fluxo de Faturas).
export async function atualizarEmailFaturas(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const email = String(formData.get("email_faturas") ?? "").trim();
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || `/faturas/imobiliaria/${imobiliariaId}`;
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);

  const { error } = await supabase
    .from("imobiliarias")
    .update({ email_faturas: email || null })
    .eq("id", imobiliariaId);
  if (error) {
    redirect(`${voltarPara}?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`${voltarPara}?ok=${encodeURIComponent("E-mail salvo.")}`);
}

// "Editar" de quem ainda não tem CNPJ/CPF vinculado (nome_provisorio) —
// resolve/cria o registro de verdade em imobiliarias E já salva tudo que
// foi preenchido na mesma tela (e-mail de faturas + dados de cada
// seguradora), como um cadastro completo de uma vez só. Converte TODAS as
// linhas provisórias com esse nome (pode haver uma por seguradora, já que
// a lista principal é única entre seguradoras).
export async function resolverImobiliariaProvisoria(formData: FormData) {
  const supabase = await checarAcesso();

  const nomeProvisorio = String(formData.get("nome_provisorio") ?? "").trim();
  const cnpj = String(formData.get("cnpj") ?? "").trim();
  if (!nomeProvisorio || !cnpj) {
    redirect(
      `/faturas/imobiliaria/novo?erro=${encodeURIComponent("Informe o CNPJ ou CPF.")}&nome=${encodeURIComponent(nomeProvisorio)}`
    );
  }

  let imobiliariaId: string;
  try {
    imobiliariaId = await resolverOuCriarImobiliaria(supabase, nomeProvisorio, cnpj);
  } catch (e) {
    redirect(
      `/faturas/imobiliaria/novo?erro=${encodeURIComponent(e instanceof Error ? e.message : "Falha ao registrar imobiliária.")}&nome=${encodeURIComponent(nomeProvisorio)}`
    );
  }

  await supabase
    .from("faturas_esperadas")
    .update({ imobiliaria_id: imobiliariaId, nome_provisorio: null })
    .eq("nome_provisorio", nomeProvisorio)
    .is("imobiliaria_id", null);

  const emailFaturas = String(formData.get("email_faturas") ?? "").trim();
  if (emailFaturas) {
    await supabase.from("imobiliarias").update({ email_faturas: emailFaturas }).eq("id", imobiliariaId);
  }

  const qtd = Number(formData.get("qtd") ?? 0);
  for (let i = 0; i < qtd; i++) {
    const seguradora = String(formData.get(`seguradora_${i}`) ?? "").trim();
    if (!seguradora) continue;
    const ativo = formData.get(`ativo_${i}`) === "on";
    const diaVencimento = String(formData.get(`dia_vencimento_${i}`) ?? "").trim();
    const cnpjO2 = String(formData.get(`cnpj_o2_${i}`) ?? "").trim();
    const observacao = String(formData.get(`observacao_${i}`) ?? "").trim();

    if (!ativo && !diaVencimento && !cnpjO2 && !observacao) continue;

    await supabase.from("faturas_esperadas").upsert(
      {
        imobiliaria_id: imobiliariaId,
        seguradora,
        ativo,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
        cnpj_o2: cnpjO2,
        observacao: observacao || null,
      },
      { onConflict: "imobiliaria_id, seguradora, cnpj_o2" }
    );
  }

  redirect(`/faturas/imobiliaria/${imobiliariaId}?ok=${encodeURIComponent("Imobiliária cadastrada.")}`);
}
