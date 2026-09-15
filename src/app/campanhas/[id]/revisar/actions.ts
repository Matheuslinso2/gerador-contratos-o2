"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail } from "@/lib/email";
import { montarHtmlCampanha, ENDERECO_REMETENTE_CAMPANHAS, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { linkDescadastro } from "@/lib/campanhas/unsubscribeToken";
import { emailsElegiveisCampanha } from "@/lib/campanhas/elegibilidade";

// Mesmo endereço de modo teste usado em faturas/enviar (EMAIL_MODO_TESTE) --
// deixa revisar layout/conteúdo real antes de disparar de verdade.
const EMAIL_MODO_TESTE = "matheus@o2seguros.com.br";

function querystringImob(formData: FormData): string {
  return formData
    .getAll("imob")
    .map((v) => `&imob=${encodeURIComponent(String(v))}`)
    .join("");
}

export async function enviarTesteCampanha(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const qs = querystringImob(formData);

  const { data: campanha } = await supabase
    .from("campanhas")
    .select("id, assunto, template, titulo, introducao, valido_de, valido_ate, corpo_html, cta_texto, cta_href")
    .eq("id", campanhaId)
    .single<CampanhaRow>();
  if (!campanha) redirect(`/campanhas/${campanhaId}/revisar?erro=${encodeURIComponent("Campanha não encontrada.")}${qs}`);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    redirect(`/campanhas/${campanhaId}/revisar?erro=${encodeURIComponent("NEXT_PUBLIC_SITE_URL não configurada.")}${qs}`);
  }

  const unsubscribeHref = linkDescadastro(EMAIL_MODO_TESTE, siteUrl);
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
    redirect(
      `/campanhas/${campanhaId}/revisar?erro=${encodeURIComponent(erro instanceof Error ? erro.message : String(erro))}${qs}`
    );
  }

  redirect(`/campanhas/${campanhaId}/revisar?ok=${encodeURIComponent(`E-mail de teste enviado para ${EMAIL_MODO_TESTE}.`)}${qs}`);
}

// Explode a seleção de imobiliárias em linhas individuais de
// campanhas_envios (1 por endereço de e-mail) e marca a campanha como
// "enviando" -- o processamento de fato acontece em src/lib/campanhas/
// processarLote.ts, chamado pela tela de progresso.
export async function confirmarDisparoCampanha(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const imobiliariaIds = formData.getAll("imob").map(String).filter(Boolean);
  const qs = querystringImob(formData);
  if (!campanhaId || !imobiliariaIds.length) {
    redirect(`/campanhas/${campanhaId}/revisar?erro=${encodeURIComponent("Selecione ao menos um destinatário.")}${qs}`);
  }

  const [{ data: imobiliariasData }, { data: descadastrosData }] = await Promise.all([
    supabase.from("imobiliarias").select("id, email, email_faturas, email_repasses, email_campanhas").in("id", imobiliariaIds),
    supabase.from("campanhas_descadastros").select("email"),
  ]);
  const descadastrados = new Set((descadastrosData ?? []).map((d) => d.email.toLowerCase()));

  const linhas: { campanha_id: string; imobiliaria_id: string; email: string }[] = [];
  const vistos = new Set<string>();
  for (const i of imobiliariasData ?? []) {
    for (const emailBruto of emailsElegiveisCampanha(i, descadastrados)) {
      const email = emailBruto.trim().toLowerCase();
      if (!email || vistos.has(email)) continue;
      vistos.add(email);
      linhas.push({ campanha_id: campanhaId, imobiliaria_id: i.id, email });
    }
  }

  if (!linhas.length) {
    redirect(`/campanhas/${campanhaId}/revisar?erro=${encodeURIComponent("Nenhum e-mail elegível entre os selecionados.")}${qs}`);
  }

  const { error: erroInsert } = await supabase
    .from("campanhas_envios")
    .upsert(linhas, { onConflict: "campanha_id,email", ignoreDuplicates: true });
  if (erroInsert) {
    redirect(`/campanhas/${campanhaId}/revisar?erro=${encodeURIComponent(erroInsert.message)}${qs}`);
  }

  await supabase
    .from("campanhas")
    .update({ status: "enviando", total_destinatarios: linhas.length, disparada_em: new Date().toISOString() })
    .eq("id", campanhaId);

  redirect(`/campanhas/${campanhaId}`);
}
