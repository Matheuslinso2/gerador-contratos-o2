"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail } from "@/lib/email";
import { montarHtmlCampanha, ENDERECO_REMETENTE_CAMPANHAS, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { linkDescadastro } from "@/lib/campanhas/unsubscribeToken";
import { dispararCampanha } from "@/lib/campanhas/dispararCampanha";

// Fuso fixo -03:00 (Brasil não tem mais horário de verão desde 2019) --
// <input type="datetime-local"> devolve "AAAA-MM-DDTHH:mm" sem fuso
// nenhum, então trata direto como horário de Brasília.
const OFFSET_BRASILIA = "-03:00";

// Mesmo endereço de modo teste usado em faturas/enviar.
const EMAIL_MODO_TESTE = "matheus@o2seguros.com.br";

async function exigirAcessoRascunhoRPC(campanhaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada, recarregue a página.");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) throw new Error("Sem permissão.");

  const { data: campanha } = await supabase
    .from("campanhas")
    .select("id, status, imobiliarias_selecionadas, contatos_externos_selecionados")
    .eq("id", campanhaId)
    .single();
  if (!campanha) throw new Error("Campanha não encontrada.");
  if (campanha.status !== "rascunho") throw new Error("Essa campanha não está mais em rascunho -- recarregue a página.");

  return { supabase, campanha };
}

// Chamadas imperativamente do componente cliente GerenciarDestinatarios
// (pedido do Matheus, 15/09/2026: edição sem recarregar a página) -- nunca
// fazem redirect, só gravam e devolvem/lançam erro, pro componente
// atualizar o estado local sozinho sem um novo carregamento de página.

export async function alternarImobiliariaCampanha(campanhaId: string, imobiliariaId: string, incluir: boolean) {
  const { supabase, campanha } = await exigirAcessoRascunhoRPC(campanhaId);
  const atuais = new Set<string>((campanha.imobiliarias_selecionadas as string[] | null) ?? []);
  if (incluir) atuais.add(imobiliariaId);
  else atuais.delete(imobiliariaId);

  const { error } = await supabase.from("campanhas").update({ imobiliarias_selecionadas: [...atuais] }).eq("id", campanhaId);
  if (error) throw new Error(error.message);
}

// grupo_imobiliaria_ids/grupo_contato_ids vêm do próprio cliente (ele já
// tem os membros do grupo carregados) -- não é furo de segurança: quem tem
// acesso a essa tela já pode incluir qualquer imobiliária individualmente
// do mesmo jeito, então passar os ids do grupo não abre nada que já não
// desse pra fazer um por um.
export async function alternarGrupoCampanha(
  campanhaId: string,
  grupoImobiliariaIds: string[],
  grupoContatoIds: string[],
  incluir: boolean
) {
  const { supabase, campanha } = await exigirAcessoRascunhoRPC(campanhaId);
  const imobsAtuais = new Set<string>((campanha.imobiliarias_selecionadas as string[] | null) ?? []);
  const contatosAtuais = new Set<string>((campanha.contatos_externos_selecionados as string[] | null) ?? []);

  if (incluir) {
    grupoImobiliariaIds.forEach((i) => imobsAtuais.add(i));
    grupoContatoIds.forEach((c) => contatosAtuais.add(c));
  } else {
    grupoImobiliariaIds.forEach((i) => imobsAtuais.delete(i));
    grupoContatoIds.forEach((c) => contatosAtuais.delete(c));
  }

  const { error } = await supabase
    .from("campanhas")
    .update({ imobiliarias_selecionadas: [...imobsAtuais], contatos_externos_selecionados: [...contatosAtuais] })
    .eq("id", campanhaId);
  if (error) throw new Error(error.message);
}

export async function removerContatoExternoCampanha(campanhaId: string, contatoId: string) {
  const { supabase, campanha } = await exigirAcessoRascunhoRPC(campanhaId);
  const atuais = ((campanha.contatos_externos_selecionados as string[] | null) ?? []).filter((i) => i !== contatoId);

  const { error } = await supabase.from("campanhas").update({ contatos_externos_selecionados: atuais }).eq("id", campanhaId);
  if (error) throw new Error(error.message);
}

// Envio de teste não depende da seleção de destinatários -- só manda o
// template renderizado pro próprio remetente, pra revisar layout/conteúdo
// antes de disparar de verdade.
export async function enviarTesteCampanha(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const { data: campanha } = await supabase
    .from("campanhas")
    .select("id, assunto, template, titulo, introducao, valido_de, valido_ate, corpo_html, cta_texto, cta_href")
    .eq("id", campanhaId)
    .single<CampanhaRow>();
  if (!campanha) redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Campanha não encontrada.")}`);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("NEXT_PUBLIC_SITE_URL não configurada.")}`);

  const unsubscribeHref = linkDescadastro(EMAIL_MODO_TESTE, siteUrl, campanhaId);
  const html = montarHtmlCampanha(campanha, unsubscribeHref);

  try {
    await enviarEmail({
      para: EMAIL_MODO_TESTE,
      assunto: `[TESTE] ${campanha.assunto}`,
      html,
      remetente: "O2 Seguros",
      enderecoRemetente: ENDERECO_REMETENTE_CAMPANHAS,
      throwSeFalhar: true,
    });
  } catch (erro) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent(erro instanceof Error ? erro.message : String(erro))}`);
  }

  redirect(`/campanhas/${campanhaId}?ok=${encodeURIComponent(`E-mail de teste enviado para ${EMAIL_MODO_TESTE}.`)}`);
}

// Dispara AGORA a seleção já salva na campanha (imobiliarias_selecionadas +
// contatos_externos_selecionados) -- explode em linhas de campanhas_envios
// e marca "enviando" via dispararCampanha (compartilhada com o cron de
// agendamento). O processamento de fato acontece em
// src/lib/campanhas/processarLote.ts, chamado pela tela de progresso.
export async function confirmarDisparoCampanha(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const resultado = await dispararCampanha(supabase, campanhaId);
  if (!resultado.ok) redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent(resultado.erro)}`);

  redirect(`/campanhas/${campanhaId}`);
}

// Item 9 da reunião de 15/09/2026: agenda o disparo pra mais tarde em vez
// de mandar agora -- não explode em campanhas_envios ainda, só marca
// status "agendada" + agendado_para. Quem dispara de fato quando a hora
// chegar é o cron (src/app/api/cron/enviar-campanhas/route.ts), que roda a
// cada 5 min.
export async function agendarDisparoCampanha(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const dataHoraLocal = String(formData.get("agendado_para") ?? "").trim();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  if (!dataHoraLocal) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Escolha uma data e horário pro agendamento.")}`);
  }
  const agendadoPara = new Date(`${dataHoraLocal}:00${OFFSET_BRASILIA}`);
  if (Number.isNaN(agendadoPara.getTime()) || agendadoPara.getTime() <= Date.now()) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("A data do agendamento precisa ser no futuro.")}`);
  }

  const { data: campanha } = await supabase
    .from("campanhas")
    .select("id, status, imobiliarias_selecionadas, contatos_externos_selecionados")
    .eq("id", campanhaId)
    .single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "rascunho") redirect(`/campanhas/${campanhaId}`);
  const temSelecao =
    ((campanha.imobiliarias_selecionadas as string[] | null) ?? []).length ||
    ((campanha.contatos_externos_selecionados as string[] | null) ?? []).length;
  if (!temSelecao) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Selecione ao menos um destinatário antes de agendar.")}`);
  }

  const { error } = await supabase
    .from("campanhas")
    .update({ status: "agendada", agendado_para: agendadoPara.toISOString() })
    .eq("id", campanhaId);
  if (error) redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent(error.message)}`);

  redirect(`/campanhas/${campanhaId}?ok=${encodeURIComponent("Disparo agendado.")}`);
}

// Cancelar volta pra rascunho (editável de novo), não é um estado
// terminal -- a campanha continua existindo, só perde a data marcada.
export async function cancelarAgendamentoCampanha(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const { data: campanha } = await supabase.from("campanhas").select("id, status").eq("id", campanhaId).single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "agendada") redirect(`/campanhas/${campanhaId}`);

  await supabase.from("campanhas").update({ status: "rascunho", agendado_para: null }).eq("id", campanhaId);
  redirect(`/campanhas/${campanhaId}?ok=${encodeURIComponent("Agendamento cancelado.")}`);
}

// Pedido do Matheus, 17/09/2026: antes do envio precisa dar pra corrigir
// conteúdo/campos da campanha sem ter que recriar do zero -- espelha
// criarCampanha (campanhas/nova/actions.ts) mas fazendo update em vez de
// insert, e só funciona em rascunho (mesma trava de agendarDisparoCampanha
// acima; depois de agendada/disparada o conteúdo já foi ou vai ser usado).
export async function editarConteudoCampanha(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const { data: campanha } = await supabase.from("campanhas").select("id, status").eq("id", campanhaId).single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "rascunho") redirect(`/campanhas/${campanhaId}`);

  const nome = String(formData.get("nome") ?? "").trim();
  const assunto = String(formData.get("assunto") ?? "").trim();
  const template = String(formData.get("template") ?? "comunicado");
  const titulo = String(formData.get("titulo") ?? "").trim();
  const introducao = String(formData.get("introducao") ?? "").trim();
  const validoDe = String(formData.get("valido_de") ?? "").trim();
  const validoAte = String(formData.get("valido_ate") ?? "").trim();
  const produto = String(formData.get("produto") ?? "").trim();
  const corpoHtml = String(formData.get("corpo_html") ?? "").trim();
  const ctaTexto = String(formData.get("cta_texto") ?? "").trim();
  const ctaHref = String(formData.get("cta_href") ?? "").trim();

  const temConteudo = corpoHtml.replace(/<[^>]+>/g, "").trim().length > 0 || /<img[\s>]/i.test(corpoHtml);
  if (!nome || !assunto || !titulo || !temConteudo || !produto) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Preencha nome, produto, assunto, título e corpo da campanha.")}`);
  }
  if (validoDe && validoAte && validoDe > validoAte) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("A data \"válido de\" não pode ser depois de \"válido até\".")}`);
  }

  const { error } = await supabase
    .from("campanhas")
    .update({
      nome,
      assunto,
      template,
      titulo,
      introducao: introducao || null,
      valido_de: validoDe || null,
      valido_ate: validoAte || null,
      produto,
      corpo_html: corpoHtml,
      cta_texto: ctaTexto || null,
      cta_href: ctaHref || null,
    })
    .eq("id", campanhaId);

  if (error) redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent(error.message)}`);

  redirect(`/campanhas/${campanhaId}?ok=${encodeURIComponent("Conteúdo da campanha atualizado.")}`);
}
