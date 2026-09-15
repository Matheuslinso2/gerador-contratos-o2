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

// Explode a seleção JÁ SALVA na campanha (imobiliarias_selecionadas +
// contatos_externos_selecionados) em linhas individuais de campanhas_envios
// (1 por endereço de e-mail) e marca a campanha como "enviando" -- o
// processamento de fato acontece em src/lib/campanhas/processarLote.ts,
// chamado pela tela de progresso. A tela principal da campanha é a única
// fonte de verdade da seleção, então o botão de disparo só precisa do
// campanha_id.
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
