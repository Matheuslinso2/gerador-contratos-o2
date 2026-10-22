"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { METRICAS_META, montarDesempenhoCampanha, produtosBaseDaCampanha } from "@/lib/campanhas/desempenho";
import { participantesDaCampanha } from "@/lib/campanhas/metasCampanha";
import { montarEmailParcial } from "@/lib/campanhas/parcialCampanha";
import { limparNomeRemetente } from "@/lib/campanhas/remetente";
import { produtosDaCampanha } from "@/lib/campanhas/produtos";
import { imobiliariasDaCampanha } from "@/lib/campanhas/imobiliariasDaCampanha";

// Metas, responsável da O2 e parciais da campanha (22/10/2026).

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
  dados: { meta: string; custo: string; observacao: string; responsavel: string }
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

// Parcial: um e-mail filho da campanha por participante COM meta, com os
// números de hoje (cada imobiliária vê só os próprios). Fica como rascunho
// ou já agendado; revisão e disparo seguem o fluxo normal de e-mail.
export async function gerarParciaisCampanha(campanhaId: string, formData: FormData) {
  const { supabase, user } = await exigirEquipe();
  const remetenteNome = limparNomeRemetente(formData.get("remetente_nome"));
  const agendarTexto = String(formData.get("agendado_para") ?? "").trim();
  let agendadoPara: string | null = null;
  if (agendarTexto) {
    const data = new Date(`${agendarTexto}:00-03:00`);
    if (Number.isNaN(data.getTime()) || data.getTime() <= Date.now()) voltar(campanhaId, "erro", "O agendamento da parcial precisa ser no futuro.");
    agendadoPara = data.toISOString();
  }

  const { data: campanha } = await supabase.from("campanhas").select("*").eq("id", campanhaId).maybeSingle();
  if (!campanha) redirect("/campanhas");
  if (!campanha.meta_metrica || !campanha.valido_de || !campanha.valido_ate) voltar(campanhaId, "erro", "Defina a meta e o período da campanha antes de gerar parciais.");

  const db = createServiceClient();
  const idsImobs = await imobiliariasDaCampanha(db, campanha);
  const { participantes } = await participantesDaCampanha(db, campanhaId, idsImobs);
  const comMeta = participantes.filter((p) => p.meta !== null && p.meta > 0);
  if (!comMeta.length) voltar(campanhaId, "erro", "Nenhuma imobiliária tem meta: preencha as metas no quadro antes de gerar as parciais.");

  const produtosCampanha = produtosDaCampanha(campanha);
  const config = {
    nome: campanha.nome as string,
    produtos: produtosBaseDaCampanha(produtosCampanha),
    metrica: campanha.meta_metrica as string,
    inicio: campanha.valido_de as string,
    fim: campanha.valido_ate as string,
    premiacao_descricao: (campanha.premiacao_descricao as string | null) ?? null,
    custo_premiacao_geral: Number(campanha.custo_premiacao_geral) || 0,
  };
  const desempenho = await montarDesempenhoCampanha(db, config, comMeta);

  const gruposIds = comMeta.filter((p) => p.grupo_id).map((p) => p.grupo_id as string);
  const membros = new Map<string, string[]>();
  if (gruposIds.length) {
    const { data } = await db.from("imobiliarias").select("id, grupo_id").in("grupo_id", gruposIds);
    for (const m of (data ?? []) as { id: string; grupo_id: string }[]) membros.set(m.grupo_id, [...(membros.get(m.grupo_id) ?? []), m.id]);
  }

  const novos = comMeta
    .map((p) => {
      const linha = desempenho.linhas.find((l) => l.participanteId === p.id);
      const destinatarios = p.imobiliaria_id ? [p.imobiliaria_id] : (membros.get(p.grupo_id as string) ?? []);
      if (!linha || !destinatarios.length) return null;
      const e = montarEmailParcial(config, linha, desempenho.hoje, desempenho.diasRestantes);
      return {
        nome: e.nome,
        assunto: e.assunto,
        template: "comunicado",
        personalizacao: "nenhuma",
        titulo: e.titulo,
        introducao: e.introducao,
        corpo_html: e.corpoHtml,
        valido_de: config.inicio,
        valido_ate: config.fim,
        produto: produtosCampanha[0] ?? "institucional",
        produtos: produtosCampanha.length ? produtosCampanha : ["institucional"],
        campanha_pai_id: campanhaId,
        imobiliarias_selecionadas: destinatarios,
        remetente_nome: remetenteNome ?? (campanha.remetente_nome as string | null) ?? null,
        criado_por: user.id,
        criado_por_email: user.email,
        status: agendadoPara ? "agendada" : "rascunho",
        agendado_para: agendadoPara,
      };
    })
    .filter((l): l is NonNullable<typeof l> => !!l);

  const { error } = await supabase.from("campanhas").insert(novos);
  if (error) voltar(campanhaId, "erro", `Não consegui gerar as parciais: ${error.message}`);
  const semMeta = participantes.length - comMeta.length;
  voltar(
    campanhaId,
    "ok",
    `${novos.length} parcial(is) ${agendadoPara ? "agendada(s)" : "criada(s) como rascunho"}` +
      (semMeta ? ` · ${semMeta} imobiliária(s) sem meta ficaram de fora` : "") +
      '. Estão em "E-mails desta campanha".'
  );
}
