"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traduzirErroAuth } from "@/lib/authErrors";
import { origem } from "@/lib/origem";
import { apenasDigitos, validarCnpjOuCpf } from "@/lib/validacoesBr";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Vincula o login novo a uma imobiliária já conhecida no sistema (ex:
// importada do Corp, ainda sem login) quando o CPF/CNPJ bate -- em vez de
// criar duplicata. Mesmo critério de dedup que /imobiliaria/actions.ts já
// usa (comparação por dígitos), mas com o cuidado extra de nunca sobrescrever
// o dono de uma imobiliária que já tem conta (aí é duplicidade de verdade,
// não vínculo -- segue como cadastro novo em vez de travar o signup por um
// problema que não é da pessoa se cadastrando, mesma filosofia de lá).
async function vincularOuCriarImobiliaria(
  supabase: SupabaseServerClient,
  dados: { userId: string; email: string; nome: string; cnpj: string; endereco: string; responsavel: string }
): Promise<void> {
  const cnpjDigitos = apenasDigitos(dados.cnpj);
  const { data: todas } = await supabase.from("imobiliarias").select("id, user_id, endereco, responsavel, cnpj");
  const existente = (todas ?? []).find((i) => apenasDigitos(i.cnpj ?? "") === cnpjDigitos) ?? null;

  if (existente && !existente.user_id) {
    await supabase
      .from("imobiliarias")
      .update({
        user_id: dados.userId,
        email: dados.email,
        autorizado: false,
        // Preserva dado já cadastrado (ex: vindo do Corp) -- só completa o
        // que estiver vazio, não sobrescreve com o que a pessoa digitou.
        endereco: existente.endereco || dados.endereco,
        responsavel: existente.responsavel || dados.responsavel,
      })
      .eq("id", existente.id);
    return;
  }

  // Sem match, ou CNPJ já pertence a outra conta (duplicidade de verdade,
  // resolve depois em /admin/imobiliarias) -- cria um cadastro novo.
  // Placeholders nos campos de configuração de contrato seguem o mesmo
  // padrão já usado em resolverOuCriarImobiliaria (faturasIdentificacao.ts):
  // ainda não configurados, cadastro_incompleto sinaliza isso.
  await supabase.from("imobiliarias").insert({
    nome: dados.nome,
    cnpj: dados.cnpj,
    endereco: dados.endereco,
    responsavel: dados.responsavel,
    email: dados.email,
    user_id: dados.userId,
    autorizado: false,
    texto_base_contrato: "",
    indice_reajuste: "",
    percentual_multa_atraso: 0,
    percentual_juros_mora: 0,
    percentual_honorarios_advocaticios: 0,
    cadastro_incompleto: true,
  });
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const aceiteTermos = formData.get("aceite_termos") === "on";
  const nome = String(formData.get("nome_imobiliaria") ?? "").trim();
  const cnpj = String(formData.get("cnpj_cpf") ?? "").trim();
  const endereco = String(formData.get("endereco") ?? "").trim();
  const responsavel = String(formData.get("responsavel") ?? "").trim();

  if (!aceiteTermos) {
    redirect(`/signup?erro=${encodeURIComponent("É necessário aceitar os Termos de Uso e a Política de Privacidade.")}`);
  }
  if (password.length < 6) {
    redirect(`/signup?erro=${encodeURIComponent("A senha precisa ter pelo menos 6 caracteres.")}`);
  }

  // Cada conta representa uma imobiliária/administradora (ver page.tsx) --
  // esses dados viram o cadastro em `imobiliarias`, pendente de autorização
  // da O2 até o Matheus analisar (ver src/lib/autorizacaoImobiliaria.ts).
  const faltando: string[] = [];
  if (!nome) faltando.push("Nome da imobiliária");
  if (!cnpj) faltando.push("CPF ou CNPJ");
  else if (!validarCnpjOuCpf(cnpj)) faltando.push("CPF/CNPJ válido — confira os números digitados");
  if (!endereco) faltando.push("Endereço");
  if (!responsavel) faltando.push("Nome do responsável");
  if (faltando.length > 0) {
    redirect(`/signup?erro=${encodeURIComponent(`Preencha os campos obrigatórios: ${faltando.join(", ")}.`)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await origem()}/`,
      data: {
        termos_aceitos_em: new Date().toISOString(),
      },
    },
  });
  if (error) {
    redirect(`/signup?erro=${encodeURIComponent(traduzirErroAuth(error.message))}`);
  }
  if (!data.user) {
    redirect(`/signup?erro=${encodeURIComponent("Não foi possível criar a conta. Tente novamente.")}`);
  }

  // data.user já vem preenchido mesmo quando a confirmação de e-mail está
  // pendente (data.session é que fica null nesse caso) -- dá pra vincular o
  // cadastro da imobiliária de qualquer jeito, sem esperar o login de fato.
  await vincularOuCriarImobiliaria(supabase, { userId: data.user.id, email, nome, cnpj, endereco, responsavel });

  if (!data.session) {
    redirect("/login?aviso=Conta criada! Confirme seu e-mail antes de entrar.");
  }
  redirect("/");
}
