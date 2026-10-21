"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEquipe } from "@/lib/admin";
import type { Sugestao } from "@/lib/baseUnica/revisao";

// Ações da revisão uma a uma da Base Única (Fase 2). Toda decisão aqui é
// do Matheus/equipe e fica registrada com quem fez e quando; os scripts
// automáticos (src/lib/baseUnica/vinculosAutomaticos.ts) nunca desfazem uma decisão
// de pessoa. O cadastro em si continua sendo só `imobiliarias`.

async function exigirEquipe() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isEquipe(user?.email)) redirect("/");
  return { supabase, email: user!.email! };
}

function voltar(formData: FormData, mensagem: string, tipo: "sucesso" | "erro" = "sucesso"): never {
  const destino = String(formData.get("voltar_para") ?? "").trim() || "/admin/imobiliarias";
  revalidatePath("/admin/imobiliarias");
  revalidatePath(destino.split("?")[0]);
  const sep = destino.includes("?") ? "&" : "?";
  redirect(`${destino}${sep}${tipo}=${encodeURIComponent(mensagem)}#fontes`);
}

// Liga um registro de fonte a uma ficha (confirmar sugestão ou ligar à mão).
export async function ligarRegistro(formData: FormData) {
  const { supabase, email } = await exigirEquipe();
  const registroId = String(formData.get("registro_id") ?? "");
  let imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  // Na lista "nomes sem imobiliária" a ficha vem do campo de busca no
  // formato "Nome · CNPJ [uuid]" (opção da lista de fichas).
  const escolhida = String(formData.get("ficha_escolhida") ?? "");
  if (!imobiliariaId && escolhida) {
    const uuid = escolhida.match(/\[([0-9a-f-]{36})\]\s*$/)?.[1];
    if (uuid) {
      const { data } = await supabase.from("imobiliarias").select("id").eq("id", uuid).maybeSingle();
      if (data) imobiliariaId = data.id;
    }
  }
  if (!registroId || !imobiliariaId) voltar(formData, "Escolha a imobiliária na lista antes de ligar.", "erro");

  const { error } = await supabase.from("imobiliaria_registros_fonte").update({
    imobiliaria_id: imobiliariaId,
    situacao: "confirmado",
    metodo_vinculo: String(formData.get("metodo") ?? "") || "manual",
    sugestoes: [],
    confirmado_por_email: email,
    confirmado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", registroId);
  if (error) voltar(formData, error.message, "erro");
  voltar(formData, "Vínculo confirmado.");
}

// Confirma de uma vez as sugestões de NOME IGUAL que apontam só para esta
// ficha (ex.: "RAMIRO SÁ (848)", "RAMIRO SÁ (864)"… — a planilha repete o
// nome com um número diferente a cada linha). Sugestões ambíguas (mais de
// uma ficha candidata) ou só "parecidas" continuam uma a uma.
export async function confirmarSugestoesUnicas(formData: FormData) {
  const { supabase, email } = await exigirEquipe();
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const { data } = await supabase.from("imobiliaria_registros_fonte").select("id, sugestoes")
    .eq("situacao", "sugerido").eq("metodo_vinculo", "nome_exato")
    .filter("sugestoes", "cs", JSON.stringify([{ imobiliaria_id: imobiliariaId }]));
  const ids = (data ?? []).filter((r) => ((r.sugestoes ?? []) as Sugestao[]).length === 1).map((r) => r.id);
  if (!ids.length) voltar(formData, "Nenhuma sugestão de nome igual exclusiva desta ficha.", "erro");
  const agora = new Date().toISOString();
  const { error } = await supabase.from("imobiliaria_registros_fonte").update({
    imobiliaria_id: imobiliariaId, situacao: "confirmado", sugestoes: [],
    confirmado_por_email: email, confirmado_em: agora, updated_at: agora,
  }).in("id", ids);
  if (error) voltar(formData, error.message, "erro");
  voltar(formData, `${ids.length} nome(s) confirmados de uma vez.`);
}

// "Não é esta": tira esta ficha das sugestões do registro. Se não sobrar
// nenhuma, o nome volta para "sem imobiliária".
export async function recusarSugestao(formData: FormData) {
  const { supabase } = await exigirEquipe();
  const registroId = String(formData.get("registro_id") ?? "");
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const { data } = await supabase.from("imobiliaria_registros_fonte").select("sugestoes").eq("id", registroId).maybeSingle();
  const restantes = ((data?.sugestoes ?? []) as Sugestao[]).filter((s) => s.imobiliaria_id !== imobiliariaId);
  const { error } = await supabase.from("imobiliaria_registros_fonte").update({
    sugestoes: restantes,
    situacao: restantes.length ? "sugerido" : "a_identificar",
    metodo_vinculo: restantes.length ? undefined : null,
    updated_at: new Date().toISOString(),
  }).eq("id", registroId);
  if (error) voltar(formData, error.message, "erro");
  voltar(formData, "Sugestão descartada para esta ficha.");
}

// Desfaz um vínculo (automático ou manual) — o nome volta para a fila.
export async function desfazerVinculo(formData: FormData) {
  const { supabase } = await exigirEquipe();
  const registroId = String(formData.get("registro_id") ?? "");
  const { error } = await supabase.from("imobiliaria_registros_fonte").update({
    imobiliaria_id: null,
    situacao: "a_identificar",
    metodo_vinculo: null,
    confirmado_por_email: null,
    confirmado_em: null,
    updated_at: new Date().toISOString(),
  }).eq("id", registroId);
  if (error) voltar(formData, error.message, "erro");
  voltar(formData, "Vínculo desfeito — o nome voltou para a fila.");
}

// Nome que não é imobiliária (ex.: "O2", "TESTE", nome de pessoa) — sai da fila.
export async function ignorarRegistro(formData: FormData) {
  const { supabase, email } = await exigirEquipe();
  const registroId = String(formData.get("registro_id") ?? "");
  const { error } = await supabase.from("imobiliaria_registros_fonte").update({
    imobiliaria_id: null,
    situacao: "ignorar",
    sugestoes: [],
    confirmado_por_email: email,
    confirmado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", registroId);
  if (error) voltar(formData, error.message, "erro");
  voltar(formData, "Nome marcado como \"não é imobiliária\".");
}

// Grupo da ficha: escolher um existente, criar um novo ou tirar do grupo.
export async function definirGrupo(formData: FormData) {
  const { supabase, email } = await exigirEquipe();
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const escolha = String(formData.get("grupo_id") ?? "");
  const nomeNovo = String(formData.get("grupo_novo") ?? "").trim();

  let grupoId: string | null = escolha && escolha !== "__nenhum" ? escolha : null;
  if (nomeNovo) {
    const chave = nomeNovo.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    const { data, error } = await supabase.from("imobiliaria_grupos")
      .upsert({ chave, nome: nomeNovo, criado_por_email: email }, { onConflict: "chave" }).select("id").single();
    if (error || !data) voltar(formData, error?.message ?? "Falha ao criar grupo.", "erro");
    grupoId = data.id;
  }
  const { error } = await supabase.from("imobiliarias").update({ grupo_id: grupoId }).eq("id", imobiliariaId);
  if (error) voltar(formData, error.message, "erro");
  voltar(formData, grupoId ? "Grupo atualizado." : "Ficha retirada do grupo.");
}

// Leva um dado de contato de uma fonte já ligada para a ficha única.
const CAMPOS_PERMITIDOS = new Set(["telefone", "endereco", "cidade", "uf", "bairro"]);
export async function usarDadoNaFicha(formData: FormData) {
  const { supabase } = await exigirEquipe();
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const campo = String(formData.get("campo") ?? "");
  let valor = String(formData.get("valor") ?? "").trim();
  if (!CAMPOS_PERMITIDOS.has(campo) || !valor) voltar(formData, "Campo inválido.", "erro");
  if (campo === "uf") valor = valor.slice(0, 2).toUpperCase();
  const { error } = await supabase.from("imobiliarias").update({ [campo]: valor }).eq("id", imobiliariaId);
  if (error) voltar(formData, error.message, "erro");
  voltar(formData, "Ficha atualizada com o dado da fonte.");
}

export async function marcarRevisao(formData: FormData) {
  const { supabase, email } = await exigirEquipe();
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const revisada = String(formData.get("revisada") ?? "") === "1";
  const { error } = await supabase.from("imobiliarias").update({
    revisao_status: revisada ? "revisada" : "pendente",
    revisada_em: revisada ? new Date().toISOString() : null,
    revisada_por_email: revisada ? email : null,
  }).eq("id", imobiliariaId);
  if (error) voltar(formData, error.message, "erro");
  voltar(formData, revisada ? "Ficha marcada como revisada." : "Ficha voltou para pendente.");
}
