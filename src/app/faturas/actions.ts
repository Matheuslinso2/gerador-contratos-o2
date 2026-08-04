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

// Liga/desliga quais seguradoras uma imobiliária tem habilitadas — quando
// desmarcada, a linha correspondente vira inativa (não é apagada, só some
// das telas, preservando o histórico) em vez de excluir.
export async function salvarSeguradorasImobiliaria(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const todasSeguradoras = formData.getAll("todas_seguradoras").map(String);
  const marcadas = new Set(formData.getAll("seguradoras").map(String));
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);

  for (const seguradora of todasSeguradoras) {
    if (marcadas.has(seguradora)) {
      await supabase
        .from("faturas_esperadas")
        .upsert(
          { imobiliaria_id: imobiliariaId, seguradora, codigo_produtor: "", ativo: true },
          { onConflict: "imobiliaria_id, seguradora, codigo_produtor", ignoreDuplicates: false }
        );
    } else {
      await supabase
        .from("faturas_esperadas")
        .update({ ativo: false })
        .eq("imobiliaria_id", imobiliariaId)
        .eq("seguradora", seguradora);
    }
  }

  redirect(`/faturas/imobiliaria/${imobiliariaId}?ok=${encodeURIComponent("Seguradoras atualizadas.")}`);
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

// Edita dia de vencimento, CNPJ da O2 e observação de um vínculo já
// existente — os colaboradores vão precisar ajustar isso aos poucos.
export async function editarEsperada(formData: FormData) {
  const supabase = await checarAcesso();

  const id = String(formData.get("id") ?? "");
  const seguradora = String(formData.get("seguradora") ?? "").trim();
  const diaVencimento = String(formData.get("dia_vencimento") ?? "").trim();
  const cnpjO2 = String(formData.get("cnpj_o2") ?? "").trim();
  const observacao = String(formData.get("observacao") ?? "").trim();
  if (!id) redirect(`/faturas?erro=${encodeURIComponent("Registro inválido.")}`);

  const { error } = await supabase
    .from("faturas_esperadas")
    .update({
      dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
      cnpj_o2: cnpjO2 || null,
      observacao: observacao || null,
    })
    .eq("id", id);
  if (error) {
    redirect(`/faturas?erro=${encodeURIComponent(error.message)}&seguradora=${encodeURIComponent(seguradora)}`);
  }

  redirect(`/faturas?ok=${encodeURIComponent("Atualizado.")}&seguradora=${encodeURIComponent(seguradora)}`);
}
