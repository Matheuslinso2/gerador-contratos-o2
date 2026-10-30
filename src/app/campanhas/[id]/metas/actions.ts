"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { METRICAS_META } from "@/lib/campanhas/desempenho";

// Metas e responsável da O2 da campanha (22/10/2026). As parciais agora saem por parciaisActions.ts ("Enviar parciais", 30/10/2026).

async function exigirEquipe() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return { supabase, user };
}

function numero(valor: FormDataEntryValue | string | null): number | null {
  const texto = String(valor ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/i, "");
  if (!texto) return null;
  const normal = texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

const voltar = (id: string, chave: "erro" | "ok", texto: string) => redirect(`/campanhas/${id}?${chave}=${encodeURIComponent(texto)}#producao`);

export async function salvarConfigMetas(campanhaId: string, formData: FormData) {
  const { supabase } = await exigirEquipe();
  const metrica = String(formData.get("meta_metrica") ?? "");
  const validoDe = String(formData.get("valido_de") ?? "").trim() || null;
  const validoAte = String(formData.get("valido_ate") ?? "").trim() || null;
  if (validoDe && validoAte && validoAte < validoDe) voltar(campanhaId, "erro", "O fim da campanha não pode ser antes do início.");
  const { error } = await supabase
    .from("campanhas")
    .update({
      meta_metrica: METRICAS_META.some((m) => m.valor === metrica) ? metrica : null,
      premiacao_descricao: String(formData.get("premiacao_descricao") ?? "").trim() || null,
      custo_premiacao_geral: numero(formData.get("custo_premiacao_geral")) ?? 0,
      data_apuracao: String(formData.get("data_apuracao") ?? "").trim() || null,
      valido_de: validoDe,
      valido_ate: validoAte,
    })
    .eq("id", campanhaId);
  if (error) voltar(campanhaId, "erro", "Não consegui salvar a meta da campanha.");
  voltar(campanhaId, "ok", "Meta e premiação salvas.");
}

// Chamada direto da linha do quadro (sem redirect): a tela faz router.refresh().
export async function salvarMetaParticipante(
  campanhaId: string,
  alvo: { tipo: "imobiliaria" | "grupo"; id: string },
  dados: { meta: string; custo: string; observacao: string; responsavel: string; gestor: string }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada, recarregue a página.");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) throw new Error("Sem permissão.");
  const meta = numero(dados.meta);
  const custo = numero(dados.custo) ?? 0;
  if (meta !== null && meta < 0) throw new Error("A meta não pode ser negativa.");
  if (custo < 0) throw new Error("O custo não pode ser negativo.");
  const campos = {
    meta,
    custo_premiacao: custo,
    observacao: dados.observacao.trim() || null,
    responsavel_email: dados.responsavel.trim().toLowerCase() || null,
    gestor_conta_email: dados.gestor.trim().toLowerCase() || null,
    updated_at: new Date().toISOString(),
  };
  const coluna = alvo.tipo === "grupo" ? "grupo_id" : "imobiliaria_id";
  const { data: existente } = await supabase.from("campanhas_metas").select("id").eq("campanha_id", campanhaId).eq(coluna, alvo.id).maybeSingle();
  const { error } = existente
    ? await supabase.from("campanhas_metas").update(campos).eq("id", existente.id)
    : await supabase.from("campanhas_metas").insert({ campanha_id: campanhaId, [coluna]: alvo.id, ...campos });
  if (error) throw new Error("Não consegui salvar. Tente de novo.");
}

// Meta do grupo todo (uma linha somando as unidades) ou por filial.
export async function definirModoGrupo(campanhaId: string, grupoId: string, modo: "grupo" | "filial") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada, recarregue a página.");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) throw new Error("Sem permissão.");
  if (modo === "grupo") {
    const { error } = await supabase.from("campanhas_metas").insert({ campanha_id: campanhaId, grupo_id: grupoId });
    if (error && !/duplicate/i.test(error.message)) throw new Error("Não consegui mudar o modo do grupo.");
  } else {
    const { error } = await supabase.from("campanhas_metas").delete().eq("campanha_id", campanhaId).eq("grupo_id", grupoId);
    if (error) throw new Error("Não consegui mudar o modo do grupo.");
  }
}

// Contato feito por fora do Bitrix (telefone/WhatsApp particular, visita):
// fica na ficha da imobiliária (imobiliaria_contatos), lançado a partir da
// campanha. Chamado direto da linha do quadro; a tela faz router.refresh().
const CANAIS_CONTATO = ["ligacao", "whatsapp", "email", "reuniao", "visita", "outro"];

export async function registrarContatoImobiliaria(
  campanhaId: string,
  dados: { imobiliariaId: string; canal: string; data: string; feitoPor: string; observacao: string }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada, recarregue a página.");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) throw new Error("Sem permissão.");
  if (!CANAIS_CONTATO.includes(dados.canal)) throw new Error("Escolha como foi o contato.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) throw new Error("Informe a data do contato.");
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  if (dados.data > hoje) throw new Error("A data do contato não pode ser no futuro.");
  const feitoPor = (dados.feitoPor.trim() || user.email || "").toLowerCase();
  if (!feitoPor) throw new Error("Informe quem fez o contato.");
  const { error } = await supabase.from("imobiliaria_contatos").insert({
    imobiliaria_id: dados.imobiliariaId,
    campanha_id: campanhaId,
    canal: dados.canal,
    data_contato: dados.data,
    feito_por_email: feitoPor,
    observacao: dados.observacao.trim().slice(0, 500) || null,
    registrado_por_email: (user.email ?? "").toLowerCase(),
  });
  if (error) throw new Error("Não consegui registrar o contato. Tente de novo.");
}

export async function excluirContatoImobiliaria(contatoId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada, recarregue a página.");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) throw new Error("Sem permissão.");
  const { error } = await supabase.from("imobiliaria_contatos").delete().eq("id", contatoId);
  if (error) throw new Error("Não consegui apagar o contato.");
}
