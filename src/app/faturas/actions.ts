"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { resolverOuCriarImobiliaria } from "@/lib/faturasIdentificacao";
import { separarEmails } from "@/lib/email";

async function checarAcesso() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return supabase;
}

// Grava (cria ou atualiza) uma linha de faturas_esperadas à mão -- sem usar
// ON CONFLICT. Desde 03/09/2026 (migração faturas_esperadas_trava_com_codigo_produtor)
// a chave única é (imobiliária, seguradora, CNPJ O2, código do produtor), mas
// os formulários manuais não têm o código: o upsert antigo por 3 colunas
// passou a dar "no unique or exclusion constraint matching the ON CONFLICT
// specification" (visto em 08/10/2026 ao incluir a Zero Três na Porto Fiança).
// Se já existe linha pra (imobiliária, seguradora, CNPJ O2), atualiza ela
// (preservando o código do produtor que a Conferência aprendeu); senão cria
// com código vazio.
async function gravarEsperada(
  supabase: Awaited<ReturnType<typeof createClient>>,
  linha: {
    imobiliaria_id: string;
    seguradora: string;
    cnpj_o2: string;
    ativo: boolean;
    dia_vencimento?: number | null;
    observacao?: string | null;
  }
): Promise<string | null> {
  const { data: existentes, error: erroBusca } = await supabase
    .from("faturas_esperadas")
    .select("id, codigo_produtor")
    .eq("imobiliaria_id", linha.imobiliaria_id)
    .eq("seguradora", linha.seguradora)
    .eq("cnpj_o2", linha.cnpj_o2);
  if (erroBusca) return erroBusca.message;

  const alvos = (existentes ?? []).length === 1 ? existentes ?? [] : (existentes ?? []).filter((e) => e.codigo_produtor === "");
  if (alvos.length > 0) {
    const { imobiliaria_id: _i, seguradora: _s, cnpj_o2: _c, ...campos } = linha;
    void _i;
    void _s;
    void _c;
    const { error } = await supabase
      .from("faturas_esperadas")
      .update(campos)
      .in(
        "id",
        alvos.map((a) => a.id)
      );
    return error ? error.message : null;
  }

  const { error } = await supabase.from("faturas_esperadas").insert({ ...linha, codigo_produtor: "" });
  return error ? error.message : null;
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
    await supabase.from("imobiliarias").update({ email_faturas: separarEmails(emailFaturas) }).eq("id", imobiliariaId);
  }

  for (const seguradora of seguradorasSelecionadas) {
    const erro = await gravarEsperada(supabase, {
      imobiliaria_id: imobiliariaId,
      seguradora,
      cnpj_o2: "",
      ativo: true,
      dia_vencimento: Number(diaVencimento),
    });
    if (erro) {
      redirect(`/faturas?erro=${encodeURIComponent(erro)}${voltarPara}`);
    }
  }

  redirect(`/faturas?ok=${encodeURIComponent("Imobiliária salva.")}${voltarPara}`);
}

// Exclui (arquiva, mesmo padrão já usado na Conferência pra duplicata
// descartada) um arquivo de fatura/boleto já carregado -- sem isso, a
// única forma de corrigir um upload errado era subir outro arquivo pra
// forçar a detecção de duplicidade e escolher "arquivar a antiga" na
// Conferência, um caminho indireto só pra apagar algo.
// Usado via formAction (com .bind) num botão dentro do form grande de
// "Enviar selecionadas" -- NÃO pode ser um <form> aninhado dentro daquele
// (HTML não permite form dentro de form; o navegador descarta o de
// dentro e o clique acaba submetendo o formulário errado, silenciosamente).
export async function excluirArquivoFatura(faturaId: string, voltarPara: string) {
  const supabase = await checarAcesso();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!faturaId) redirect(`/faturas?erro=${encodeURIComponent("Arquivo inválido.")}${voltarPara}`);

  const { data: fatura } = await supabase
    .from("faturas")
    .select("historico_identificacao, status")
    .eq("id", faturaId)
    .single();
  if (!fatura) redirect(`/faturas?erro=${encodeURIComponent("Arquivo não encontrado.")}${voltarPara}`);
  if (fatura!.status === "enviada") {
    redirect(`/faturas?erro=${encodeURIComponent("Essa fatura já foi enviada -- não dá pra excluir.")}${voltarPara}`);
  }

  const historico = [
    ...(fatura!.historico_identificacao ?? []),
    { usuario: user?.email ?? "", data: new Date().toISOString(), acao: "excluido_manualmente", detalhe: "" },
  ];
  const { error } = await supabase
    .from("faturas")
    .update({ status: "cancelada", historico_identificacao: historico })
    .eq("id", faturaId);
  if (error) redirect(`/faturas?erro=${encodeURIComponent(error.message)}${voltarPara}`);

  redirect(`/faturas?ok=${encodeURIComponent("Arquivo excluído.")}${voltarPara}`);
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

    const erro = await gravarEsperada(supabase, {
      imobiliaria_id: imobiliariaId,
      seguradora,
      ativo,
      dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
      cnpj_o2: cnpjO2,
      observacao: observacao || null,
    });
    if (erro) redirect(`/faturas?erro=${encodeURIComponent(erro)}`);
  }

  redirect(`${voltarPara}?ok=${encodeURIComponent("Dados salvos.")}`);
}

// E-mails pra onde as faturas dessa imobiliária serão enviadas — separado
// do e-mail de login dela (esse aqui é só pro fluxo de Faturas). Cada
// endereço é sua própria posição no array (email_faturas), adicionado e
// removido individualmente em vez de reescrever a lista inteira de uma vez
// -- evita apagar um endereço por engano ao editar outro.
export async function adicionarEmailFatura(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || `/faturas/imobiliaria/${imobiliariaId}`;
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);
  if (!email || !email.includes("@")) {
    redirect(`${voltarPara}?erro=${encodeURIComponent("Informe um e-mail válido.")}`);
  }

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("email_faturas")
    .eq("id", imobiliariaId)
    .single();
  const atuais: string[] = imobiliaria?.email_faturas ?? [];
  if (atuais.some((e) => e.toLowerCase() === email.toLowerCase())) {
    redirect(`${voltarPara}?erro=${encodeURIComponent("Esse e-mail já está cadastrado.")}`);
  }

  const { error } = await supabase
    .from("imobiliarias")
    .update({ email_faturas: [...atuais, email] })
    .eq("id", imobiliariaId);
  if (error) {
    redirect(`${voltarPara}?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`${voltarPara}?ok=${encodeURIComponent("E-mail adicionado.")}`);
}

export async function removerEmailFatura(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || `/faturas/imobiliaria/${imobiliariaId}`;
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("email_faturas")
    .eq("id", imobiliariaId)
    .single();
  const atuais: string[] = imobiliaria?.email_faturas ?? [];

  const { error } = await supabase
    .from("imobiliarias")
    .update({ email_faturas: atuais.filter((e) => e !== email) })
    .eq("id", imobiliariaId);
  if (error) {
    redirect(`${voltarPara}?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`${voltarPara}?ok=${encodeURIComponent("E-mail removido.")}`);
}

// E-mails pra onde os REPASSES (relatório de comissão + comprovante de
// pagamento) dessa imobiliária serão enviados -- lista própria, separada
// de email_faturas de propósito: várias imobiliárias exigem que o repasse
// de valores vá direto pro dono/diretoria, não pro mesmo contato
// financeiro que recebe fatura de seguradora.
export async function adicionarEmailRepasse(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || `/faturas/imobiliaria/${imobiliariaId}`;
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);
  if (!email || !email.includes("@")) {
    redirect(`${voltarPara}?erro=${encodeURIComponent("Informe um e-mail válido.")}`);
  }

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("email_repasses")
    .eq("id", imobiliariaId)
    .single();
  const atuais: string[] = imobiliaria?.email_repasses ?? [];
  if (atuais.some((e) => e.toLowerCase() === email.toLowerCase())) {
    redirect(`${voltarPara}?erro=${encodeURIComponent("Esse e-mail já está cadastrado.")}`);
  }

  const { error } = await supabase
    .from("imobiliarias")
    .update({ email_repasses: [...atuais, email] })
    .eq("id", imobiliariaId);
  if (error) {
    redirect(`${voltarPara}?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`${voltarPara}?ok=${encodeURIComponent("E-mail de repasse adicionado.")}`);
}

export async function removerEmailRepasse(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || `/faturas/imobiliaria/${imobiliariaId}`;
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("email_repasses")
    .eq("id", imobiliariaId)
    .single();
  const atuais: string[] = imobiliaria?.email_repasses ?? [];

  const { error } = await supabase
    .from("imobiliarias")
    .update({ email_repasses: atuais.filter((e) => e !== email) })
    .eq("id", imobiliariaId);
  if (error) {
    redirect(`${voltarPara}?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`${voltarPara}?ok=${encodeURIComponent("E-mail de repasse removido.")}`);
}

// Código interno do Corp (ex: "406") que identifica essa imobiliária como
// "Produtor" nos relatórios de repasse -- casa com precisão assim que
// cadastrado, sem depender de adivinhar por nome/CPF a cada mês.
export async function salvarCodigoProdutorCorp(formData: FormData) {
  const supabase = await checarAcesso();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const codigo = String(formData.get("codigo_produtor_corp") ?? "").trim();
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || `/faturas/imobiliaria/${imobiliariaId}`;
  if (!imobiliariaId) redirect(`/faturas?erro=${encodeURIComponent("Imobiliária inválida.")}`);

  const { error } = await supabase
    .from("imobiliarias")
    .update({ codigo_produtor_corp: codigo || null })
    .eq("id", imobiliariaId);
  if (error) {
    redirect(`${voltarPara}?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`${voltarPara}?ok=${encodeURIComponent("Código do produtor salvo.")}`);
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
    await supabase.from("imobiliarias").update({ email_faturas: separarEmails(emailFaturas) }).eq("id", imobiliariaId);
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

    const erro = await gravarEsperada(supabase, {
      imobiliaria_id: imobiliariaId,
      seguradora,
      ativo,
      dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
      cnpj_o2: cnpjO2,
      observacao: observacao || null,
    });
    if (erro) redirect(`/faturas?erro=${encodeURIComponent(erro)}`);
  }

  redirect(`/faturas/imobiliaria/${imobiliariaId}?ok=${encodeURIComponent("Imobiliária cadastrada.")}`);
}
