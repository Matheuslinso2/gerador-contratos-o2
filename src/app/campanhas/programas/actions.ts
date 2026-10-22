"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { METRICAS_PROGRAMA, PRODUTOS_PROGRAMA, STATUS_PROGRAMA } from "@/lib/campanhas/programas";

async function exigirEquipe() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return { supabase, email: user.email ?? null };
}

function numero(valor: FormDataEntryValue | null): number | null {
  const texto = String(valor ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/i, "");
  if (!texto) return null;
  // Aceita "1.234,56" e "1234.56".
  const normal = texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

function lerCampos(formData: FormData) {
  const produtos = formData
    .getAll("produtos")
    .map(String)
    .filter((p) => PRODUTOS_PROGRAMA.some((x) => x.valor === p));
  const metrica = String(formData.get("metrica") ?? "contratacoes");
  const status = String(formData.get("status") ?? "ativa");
  return {
    nome: String(formData.get("nome") ?? "").trim(),
    objetivo: String(formData.get("objetivo") ?? "").trim() || null,
    produtos,
    metrica: METRICAS_PROGRAMA.some((m) => m.valor === metrica) ? metrica : "contratacoes",
    inicio: String(formData.get("inicio") ?? "").trim(),
    fim: String(formData.get("fim") ?? "").trim(),
    data_apuracao: String(formData.get("data_apuracao") ?? "").trim() || null,
    premiacao_descricao: String(formData.get("premiacao_descricao") ?? "").trim() || null,
    custo_premiacao_geral: numero(formData.get("custo_premiacao_geral")) ?? 0,
    status: status in STATUS_PROGRAMA ? status : "ativa",
    responsavel_email: String(formData.get("responsavel_email") ?? "").trim() || null,
  };
}

function validar(c: ReturnType<typeof lerCampos>): string | null {
  if (!c.nome) return "Dê um nome ao programa.";
  if (!c.produtos.length) return "Marque ao menos um produto.";
  if (!c.inicio || !c.fim) return "Informe o início e o fim da campanha.";
  if (c.fim < c.inicio) return "O fim não pode ser antes do início.";
  return null;
}

export async function criarPrograma(formData: FormData) {
  const { supabase, email } = await exigirEquipe();
  const campos = lerCampos(formData);
  const erro = validar(campos);
  if (erro) redirect(`/campanhas/programas/nova?erro=${encodeURIComponent(erro)}`);
  const { data, error } = await supabase
    .from("campanhas_programas")
    .insert({ ...campos, responsavel_email: campos.responsavel_email ?? email, criado_por_email: email })
    .select("id")
    .single();
  if (error || !data) redirect(`/campanhas/programas/nova?erro=${encodeURIComponent("Não consegui salvar o programa. Tente de novo.")}`);
  redirect(`/campanhas/programas/${data.id}`);
}

export async function atualizarPrograma(programaId: string, formData: FormData) {
  const { supabase } = await exigirEquipe();
  const campos = lerCampos(formData);
  const erro = validar(campos);
  if (erro) redirect(`/campanhas/programas/${programaId}?erro=${encodeURIComponent(erro)}`);
  const { error } = await supabase
    .from("campanhas_programas")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", programaId);
  if (error) redirect(`/campanhas/programas/${programaId}?erro=${encodeURIComponent("Não consegui salvar as alterações.")}`);
  redirect(`/campanhas/programas/${programaId}`);
}

export async function arquivarPrograma(programaId: string, arquivar: boolean) {
  const { supabase } = await exigirEquipe();
  await supabase
    .from("campanhas_programas")
    .update({ arquivado_em: arquivar ? new Date().toISOString() : null })
    .eq("id", programaId);
  revalidatePath("/campanhas/programas");
  redirect(arquivar ? "/campanhas/programas" : `/campanhas/programas/${programaId}`);
}

export async function excluirPrograma(programaId: string) {
  const { supabase } = await exigirEquipe();
  await supabase.from("campanhas_programas").delete().eq("id", programaId);
  redirect("/campanhas/programas");
}

// Participantes: chamadas direto do componente (sem redirect), lançam erro
// com mensagem clara que a tela mostra.
export async function adicionarParticipante(programaId: string, tipo: "imobiliaria" | "grupo", alvoId: string) {
  const { supabase } = await exigirEquipe();
  const { data: atuais } = await supabase
    .from("campanhas_programas_participantes")
    .select("imobiliaria_id, grupo_id")
    .eq("programa_id", programaId);
  const imobsAtuais = (atuais ?? []).filter((p) => p.imobiliaria_id).map((p) => p.imobiliaria_id as string);
  const gruposAtuais = (atuais ?? []).filter((p) => p.grupo_id).map((p) => p.grupo_id as string);

  // Não deixar a mesma produção contar duas vezes (unidade + grupo dela).
  if (tipo === "imobiliaria") {
    if (imobsAtuais.includes(alvoId)) throw new Error("Essa imobiliária já está no programa.");
    const { data: imob } = await supabase.from("imobiliarias").select("grupo_id").eq("id", alvoId).maybeSingle();
    if (imob?.grupo_id && gruposAtuais.includes(imob.grupo_id))
      throw new Error("Essa imobiliária já entra pelo grupo dela, que está no programa. Tire o grupo para acompanhar por unidade.");
  } else {
    if (gruposAtuais.includes(alvoId)) throw new Error("Esse grupo já está no programa.");
    if (imobsAtuais.length) {
      const { data: membros } = await supabase.from("imobiliarias").select("id").eq("grupo_id", alvoId);
      const repetidas = (membros ?? []).filter((m) => imobsAtuais.includes(m.id)).length;
      if (repetidas)
        throw new Error(`${repetidas} unidade(s) desse grupo já estão no programa individualmente. Tire as unidades para acompanhar pelo grupo inteiro.`);
    }
  }

  const { error } = await supabase
    .from("campanhas_programas_participantes")
    .insert({ programa_id: programaId, imobiliaria_id: tipo === "imobiliaria" ? alvoId : null, grupo_id: tipo === "grupo" ? alvoId : null });
  if (error) throw new Error("Não consegui adicionar. Tente de novo.");
}

export async function atualizarParticipante(
  participanteId: string,
  dados: { meta: string; custo: string; observacao: string }
) {
  const { supabase } = await exigirEquipe();
  const meta = numero(dados.meta);
  const custo = numero(dados.custo) ?? 0;
  if (meta !== null && meta < 0) throw new Error("A meta não pode ser negativa.");
  if (custo < 0) throw new Error("O custo não pode ser negativo.");
  // Sem revalidatePath: a tela chama router.refresh() (mesmo padrão de
  // GerenciarDestinatarios) -- com os dois juntos a atualização travava.
  const { error } = await supabase
    .from("campanhas_programas_participantes")
    .update({ meta, custo_premiacao: custo, observacao: dados.observacao.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", participanteId);
  if (error) throw new Error("Não consegui salvar. Tente de novo.");
}

export async function removerParticipante(participanteId: string) {
  const { supabase } = await exigirEquipe();
  const { error } = await supabase.from("campanhas_programas_participantes").delete().eq("id", participanteId);
  if (error) throw new Error("Não consegui tirar. Tente de novo.");
}
