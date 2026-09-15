"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail } from "@/lib/email";
import { montarHtmlCampanha, ENDERECO_REMETENTE_CAMPANHAS, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { linkDescadastro } from "@/lib/campanhas/unsubscribeToken";
import { emailsElegiveisCampanha } from "@/lib/campanhas/elegibilidade";

// Mesmo endereço de modo teste usado em faturas/enviar.
const EMAIL_MODO_TESTE = "matheus@o2seguros.com.br";

// Pedido da reunião de 15/09/2026: relançar uma campanha parecida sem
// reescrever tudo do zero. Copia só o conteúdo e a seleção de
// destinatários -- nunca o histórico de envio/produção, que é específico
// do disparo original.
export async function duplicarCampanha(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");

  const { data: original } = await supabase
    .from("campanhas")
    .select(
      "nome, assunto, template, titulo, introducao, valido_de, valido_ate, produto, corpo_html, cta_texto, cta_href, imobiliarias_selecionadas, contatos_externos_selecionados"
    )
    .eq("id", campanhaId)
    .single();
  if (!original) redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Campanha não encontrada.")}`);

  const { data: copia, error } = await supabase
    .from("campanhas")
    .insert({
      nome: `${original.nome} (cópia)`,
      assunto: original.assunto,
      template: original.template,
      titulo: original.titulo,
      introducao: original.introducao,
      valido_de: original.valido_de,
      valido_ate: original.valido_ate,
      produto: original.produto,
      corpo_html: original.corpo_html,
      cta_texto: original.cta_texto,
      cta_href: original.cta_href,
      imobiliarias_selecionadas: original.imobiliarias_selecionadas,
      contatos_externos_selecionados: original.contatos_externos_selecionados,
      status: "rascunho",
      criado_por: user.id,
      criado_por_email: user.email,
    })
    .select("id")
    .single();

  if (error || !copia) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent(error?.message ?? "Falha ao duplicar a campanha.")}`);
  }

  redirect(`/campanhas/${copia.id}`);
}

async function exigirAcessoRascunho(campanhaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const { data: campanha } = await supabase
    .from("campanhas")
    .select("id, status, imobiliarias_selecionadas, contatos_externos_selecionados")
    .eq("id", campanhaId)
    .single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "rascunho") redirect(`/campanhas/${campanhaId}`);

  return { supabase, campanha };
}

// Edição inline da lista de destinatários direto na tela principal da
// campanha (pedido do Matheus, 15/09/2026 -- "poderemos excluir uma imob da
// listagem, incluir uma imob, incluir um grupo ou excluir um grupo" sem
// precisar voltar pra tela de seleção). Cada ação só mexe no array
// correspondente e redireciona de volta pra mesma tela.

export async function adicionarImobiliariaAvulsa(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const { supabase, campanha } = await exigirAcessoRascunho(campanhaId);
  if (!imobiliariaId) redirect(`/campanhas/${campanhaId}`);

  const atuais = new Set<string>((campanha.imobiliarias_selecionadas as string[] | null) ?? []);
  atuais.add(imobiliariaId);
  await supabase.from("campanhas").update({ imobiliarias_selecionadas: [...atuais] }).eq("id", campanhaId);
  redirect(`/campanhas/${campanhaId}`);
}

export async function removerImobiliariaSelecionada(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const { supabase, campanha } = await exigirAcessoRascunho(campanhaId);

  const atuais = ((campanha.imobiliarias_selecionadas as string[] | null) ?? []).filter((i) => i !== imobiliariaId);
  await supabase.from("campanhas").update({ imobiliarias_selecionadas: atuais }).eq("id", campanhaId);
  redirect(`/campanhas/${campanhaId}`);
}

export async function removerContatoExternoSelecionado(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const contatoId = String(formData.get("contato_id") ?? "");
  const { supabase, campanha } = await exigirAcessoRascunho(campanhaId);

  const atuais = ((campanha.contatos_externos_selecionados as string[] | null) ?? []).filter((i) => i !== contatoId);
  await supabase.from("campanhas").update({ contatos_externos_selecionados: atuais }).eq("id", campanhaId);
  redirect(`/campanhas/${campanhaId}`);
}

export async function adicionarGrupoSelecao(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const grupoId = String(formData.get("grupo_id") ?? "");
  const { supabase, campanha } = await exigirAcessoRascunho(campanhaId);
  if (!grupoId) redirect(`/campanhas/${campanhaId}`);

  const { data: grupo } = await supabase.from("campanhas_grupos").select("imobiliaria_ids").eq("id", grupoId).maybeSingle();
  const { data: contatosGrupo } = await supabase.from("campanhas_grupos_contatos").select("id").eq("grupo_id", grupoId);

  const imobiliariasAtuais = new Set<string>((campanha.imobiliarias_selecionadas as string[] | null) ?? []);
  ((grupo?.imobiliaria_ids as string[] | null) ?? []).forEach((i) => imobiliariasAtuais.add(i));

  const contatosAtuais = new Set<string>((campanha.contatos_externos_selecionados as string[] | null) ?? []);
  (contatosGrupo ?? []).forEach((c) => contatosAtuais.add(c.id));

  await supabase
    .from("campanhas")
    .update({ imobiliarias_selecionadas: [...imobiliariasAtuais], contatos_externos_selecionados: [...contatosAtuais] })
    .eq("id", campanhaId);
  redirect(`/campanhas/${campanhaId}`);
}

export async function removerGrupoSelecao(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const grupoId = String(formData.get("grupo_id") ?? "");
  const { supabase, campanha } = await exigirAcessoRascunho(campanhaId);
  if (!grupoId) redirect(`/campanhas/${campanhaId}`);

  const { data: grupo } = await supabase.from("campanhas_grupos").select("imobiliaria_ids").eq("id", grupoId).maybeSingle();
  const { data: contatosGrupo } = await supabase.from("campanhas_grupos_contatos").select("id").eq("grupo_id", grupoId);

  const idsGrupo = new Set<string>((grupo?.imobiliaria_ids as string[] | null) ?? []);
  const idsContatosGrupo = new Set<string>((contatosGrupo ?? []).map((c) => c.id));

  const imobiliariasRestantes = ((campanha.imobiliarias_selecionadas as string[] | null) ?? []).filter((i) => !idsGrupo.has(i));
  const contatosRestantes = ((campanha.contatos_externos_selecionados as string[] | null) ?? []).filter((i) => !idsContatosGrupo.has(i));

  await supabase
    .from("campanhas")
    .update({ imobiliarias_selecionadas: imobiliariasRestantes, contatos_externos_selecionados: contatosRestantes })
    .eq("id", campanhaId);
  redirect(`/campanhas/${campanhaId}`);
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

// Explode a seleção JÁ SALVA na campanha (imobiliarias_selecionadas +
// contatos_externos_selecionados) em linhas individuais de campanhas_envios
// (1 por endereço de e-mail) e marca a campanha como "enviando" -- o
// processamento de fato acontece em src/lib/campanhas/processarLote.ts,
// chamado pela tela de progresso. Não recebe mais a lista de ids via
// formulário (pedido do Matheus, 15/09/2026): a tela principal da campanha
// é a única fonte de verdade da seleção, então o botão de disparo só
// precisa do campanha_id.
export async function confirmarDisparoCampanha(formData: FormData) {
  const campanhaId = String(formData.get("campanha_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const { data: campanha } = await supabase
    .from("campanhas")
    .select("id, status, imobiliarias_selecionadas, contatos_externos_selecionados")
    .eq("id", campanhaId)
    .single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "rascunho") redirect(`/campanhas/${campanhaId}`);

  const imobiliariaIds = (campanha.imobiliarias_selecionadas as string[] | null) ?? [];
  const contatosExternosIds = (campanha.contatos_externos_selecionados as string[] | null) ?? [];
  if (!imobiliariaIds.length && !contatosExternosIds.length) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Selecione ao menos um destinatário antes de disparar.")}`);
  }

  const [{ data: imobiliariasData }, { data: descadastrosData }, { data: contatosExternosData }] = await Promise.all([
    imobiliariaIds.length
      ? supabase.from("imobiliarias").select("id, email, email_faturas, email_repasses, email_campanhas").in("id", imobiliariaIds)
      : Promise.resolve({ data: [] }),
    supabase.from("campanhas_descadastros").select("email"),
    contatosExternosIds.length
      ? supabase.from("campanhas_grupos_contatos").select("id, email").in("id", contatosExternosIds)
      : Promise.resolve({ data: [] }),
  ]);
  const descadastrados = new Set((descadastrosData ?? []).map((d) => d.email.toLowerCase()));

  const linhas: { campanha_id: string; imobiliaria_id: string | null; email: string }[] = [];
  const vistos = new Set<string>();
  for (const i of imobiliariasData ?? []) {
    for (const emailBruto of emailsElegiveisCampanha(i, descadastrados)) {
      const email = emailBruto.trim().toLowerCase();
      if (!email || vistos.has(email)) continue;
      vistos.add(email);
      linhas.push({ campanha_id: campanhaId, imobiliaria_id: i.id, email });
    }
  }
  // Contatos de prospecção não têm imobiliaria_id (não têm cadastro no
  // Workspace) -- campanhas_envios.imobiliaria_id já é nullable pra isso.
  for (const c of contatosExternosData ?? []) {
    const email = c.email.trim().toLowerCase();
    if (!email || vistos.has(email) || descadastrados.has(email)) continue;
    vistos.add(email);
    linhas.push({ campanha_id: campanhaId, imobiliaria_id: null, email });
  }

  if (!linhas.length) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Nenhum e-mail elegível entre os selecionados.")}`);
  }

  const { error: erroInsert } = await supabase
    .from("campanhas_envios")
    .upsert(linhas, { onConflict: "campanha_id,email", ignoreDuplicates: true });
  if (erroInsert) {
    redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent(erroInsert.message)}`);
  }

  await supabase
    .from("campanhas")
    .update({ status: "enviando", total_destinatarios: linhas.length, disparada_em: new Date().toISOString() })
    .eq("id", campanhaId);

  redirect(`/campanhas/${campanhaId}`);
}
