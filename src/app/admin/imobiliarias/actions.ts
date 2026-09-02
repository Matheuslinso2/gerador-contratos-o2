"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { validarCNPJ } from "@/lib/validacoesBr";
import { prepararTextoBase } from "@/lib/limparTextoBase";

async function exigirAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect("/");
  return supabase;
}

// Único formulário pra tudo que é dado próprio da imobiliária -- mesmos
// campos que ela mesma edita em /imobiliaria (dados, contrato-base,
// cláusulas, financeiro), só que aqui o admin edita por ela. Sem upload de
// arquivo (a imobiliária já tem esse fluxo em /imobiliaria) -- aqui é só
// colar/corrigir o texto direto.
export async function atualizarImobiliariaAdmin(formData: FormData) {
  const supabase = await exigirAdmin();

  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const cnpj = String(formData.get("cnpj") ?? "").trim();
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || "/admin/imobiliarias";
  if (!id || !nome) redirect(voltarPara);
  if (cnpj && !validarCNPJ(cnpj)) {
    redirect(`${voltarPara}?erro=${encodeURIComponent("CNPJ inválido — confira os números digitados.")}`);
  }

  const { data: atual } = await supabase.from("imobiliarias").select("texto_base_contrato").eq("id", id).maybeSingle();

  let texto_base_contrato = String(formData.get("texto_base_contrato") ?? "").trim();
  let garantiaPosicao: number | null | undefined;
  if (texto_base_contrato !== atual?.texto_base_contrato) {
    try {
      const resultado = await prepararTextoBase(texto_base_contrato);
      texto_base_contrato = resultado.texto_preparado;
      garantiaPosicao = resultado.clausulas_antes_da_garantia_removida;
    } catch {
      // Preparo automático falhou -- segue com o texto como veio, melhor
      // salvar do que travar por causa disso.
    }
  }

  const dados: Record<string, unknown> = {
    nome,
    cnpj,
    creci: String(formData.get("creci") ?? "").trim() || null,
    telefone: String(formData.get("telefone") ?? "").trim() || null,
    endereco: String(formData.get("endereco") ?? "").trim() || null,
    texto_base_contrato,
    clausula_fiador: String(formData.get("clausula_fiador") ?? "").trim() || null,
    clausula_caucao: String(formData.get("clausula_caucao") ?? "").trim() || null,
    indice_reajuste: String(formData.get("indice_reajuste") ?? "").trim() || null,
    plataforma_assinatura: String(formData.get("plataforma_assinatura") ?? "").trim() || null,
    percentual_multa_atraso: Number(formData.get("percentual_multa_atraso") ?? 0),
    percentual_juros_mora: Number(formData.get("percentual_juros_mora") ?? 0),
    percentual_honorarios_advocaticios: Number(formData.get("percentual_honorarios_advocaticios") ?? 0),
  };
  if (garantiaPosicao !== undefined) dados.garantia_posicao_apos_clausula = garantiaPosicao;

  const { error } = await supabase.from("imobiliarias").update(dados).eq("id", id);
  if (error) redirect(`${voltarPara}?erro=${encodeURIComponent(error.message)}`);

  revalidatePath("/admin/imobiliarias");
  revalidatePath(voltarPara);
  redirect(`${voltarPara}?sucesso=${encodeURIComponent("Cadastro atualizado.")}`);
}

// Junta duas imobiliarias numa só (ver função mesclar_imobiliarias no
// banco) -- migra contratos, auditorias, faturas e membros do registro
// removido pro que fica, preserva o acesso de quem logava pelo removido,
// e apaga o removido. Tudo atômico dentro da função.
export async function mesclarImobiliariasAction(formData: FormData) {
  const supabase = await exigirAdmin();

  const manterId = String(formData.get("manter_id") ?? "");
  const removerIds = formData.getAll("remover_id").map(String).filter((id) => id && id !== manterId);
  const voltarPara = String(formData.get("voltar_para") ?? "").trim() || "/admin/imobiliarias";
  if (!manterId || removerIds.length === 0) redirect(voltarPara);

  // Um grupo de duplicidade pode ter mais de 2 registros -- mescla um de
  // cada vez, na mesma função atômica, até sobrar só o escolhido.
  for (const removerId of removerIds) {
    const { error } = await supabase.rpc("mesclar_imobiliarias", {
      p_manter_id: manterId,
      p_remover_id: removerId,
    });
    if (error) redirect(`${voltarPara}?erro=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/imobiliarias");
  redirect(`/admin/imobiliarias/${manterId}?sucesso=${encodeURIComponent("Cadastros mesclados com sucesso.")}`);
}

// Exclusão direta só é permitida pra registro sem nada vinculado (ex: um
// esqueleto do Faturas que nunca foi reivindicado e nunca teve fatura de
// verdade) -- qualquer coisa com dado real precisa passar por Mesclar em
// vez de excluir, pra não perder contrato/auditoria/fatura.
export async function excluirImobiliariaAdmin(formData: FormData) {
  const supabase = await exigirAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/imobiliarias");

  const [{ count: contratos }, { count: auditorias }, { count: faturasEsperadas }, { count: membros }] = await Promise.all([
    supabase.from("contratos").select("id", { count: "exact", head: true }).eq("imobiliaria_id", id),
    supabase.from("auditorias_contrato").select("id", { count: "exact", head: true }).eq("imobiliaria_id", id),
    supabase.from("faturas_esperadas").select("id", { count: "exact", head: true }).eq("imobiliaria_id", id),
    supabase.from("imobiliaria_membros").select("id", { count: "exact", head: true }).eq("imobiliaria_id", id),
  ]);
  const temDadosLigados = (contratos ?? 0) + (auditorias ?? 0) + (faturasEsperadas ?? 0) + (membros ?? 0) > 0;
  if (temDadosLigados) {
    redirect(
      `/admin/imobiliarias?erro=${encodeURIComponent(
        "Esse cadastro tem contrato, auditoria, fatura esperada ou membro vinculado — use Mesclar em vez de excluir."
      )}`
    );
  }

  const { error } = await supabase.from("imobiliarias").delete().eq("id", id);
  if (error) redirect(`/admin/imobiliarias?erro=${encodeURIComponent(error.message)}`);

  revalidatePath("/admin/imobiliarias");
  redirect("/admin/imobiliarias?sucesso=Cadastro removido.");
}

// Versão admin de adicionar/remover membro (ver src/app/imobiliaria/actions.ts
// pro fluxo self-service) -- opera num imobiliaria_id explícito em vez de
// resolver "a imobiliária de quem está logado", já que aqui é o admin
// mexendo em nome de terceiros.
export async function adicionarMembroImobiliariaAdmin(formData: FormData) {
  const supabase = await exigirAdmin();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!imobiliariaId) redirect("/admin/imobiliarias");
  if (!email || !email.includes("@")) {
    redirect(`/admin/imobiliarias/${imobiliariaId}?erro=${encodeURIComponent("E-mail inválido.")}`);
  }

  const { error } = await supabase.from("imobiliaria_membros").insert({ imobiliaria_id: imobiliariaId, email });
  if (error) {
    const mensagem = error.code === "23505" ? "Esse e-mail já tem acesso." : error.message;
    redirect(`/admin/imobiliarias/${imobiliariaId}?erro=${encodeURIComponent(mensagem)}`);
  }

  revalidatePath(`/admin/imobiliarias/${imobiliariaId}`);
  redirect(`/admin/imobiliarias/${imobiliariaId}?sucesso=${encodeURIComponent("Membro adicionado.")}`);
}

export async function removerMembroImobiliariaAdmin(formData: FormData) {
  const supabase = await exigirAdmin();

  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const membroId = String(formData.get("membro_id") ?? "");
  if (!imobiliariaId || !membroId) redirect("/admin/imobiliarias");

  await supabase.from("imobiliaria_membros").delete().eq("id", membroId).eq("imobiliaria_id", imobiliariaId);

  revalidatePath(`/admin/imobiliarias/${imobiliariaId}`);
  redirect(`/admin/imobiliarias/${imobiliariaId}?sucesso=${encodeURIComponent("Membro removido.")}`);
}
