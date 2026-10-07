"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { buscarTemplateAviso } from "@/lib/avisosInternos/templates";
import { montarHtmlAvisoInterno } from "@/lib/avisosInternos/email";
import { COOKIE_MENSAGEM_AVISO } from "@/lib/avisosInternos/cookie";
import { enviarPendentesDoAviso } from "@/lib/avisosInternos/envio";

// Remetente transacional (avisos@), não o de marketing -- comunicado
// interno da RH não é campanha comercial, não precisa (nem deve ter)
// rodapé de descadastro. Pedido do Matheus, 07/10/2026: cada pessoa recebe o
// PRÓPRIO e-mail (não mais todo mundo num "to" só) e o aviso fica registrado
// em avisos_internos_historico/envios, pra acompanhar quem abriu e quem não
// abriu (ver /campanhas/avisos-internos/enviados/[id]).
export async function enviarAvisoInterno(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const templateId = String(formData.get("template") ?? "");
  const template = buscarTemplateAviso(templateId);
  if (!template) redirect("/campanhas/avisos-internos");

  const valores: Record<string, string> = Object.fromEntries(template.campos.map((c) => [c.key, String(formData.get(c.key) ?? "").trim()]));
  const mensagemHtml = String(formData.get("mensagem_html") ?? "").trim();

  const camposFaltando = template.campos.filter((c) => c.obrigatorio && !valores[c.key]);
  if (camposFaltando.length) {
    redirect(`/campanhas/avisos-internos/novo?template=${template.id}&erro=${encodeURIComponent("Preencha todos os campos obrigatórios.")}`);
  }

  // mensagem_html não entra mais na URL de retorno (vinha de um cookie
  // de curta duração, ver novo/actions.ts) -- a própria /revisar relê o
  // cookie de novo ao recarregar, então não precisa (nem cabe, se grande)
  // reembutir o HTML na query string dos redirects de erro abaixo.
  const voltarComErro = (erro: string): never =>
    redirect(`/campanhas/avisos-internos/revisar?${new URLSearchParams({ template: template.id, ...valores }).toString()}&erro=${encodeURIComponent(erro)}`);

  const { data: grupo } = await supabase
    .from("avisos_internos_grupos")
    .select("emails")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const emails = [...new Set(((grupo?.emails as string[] | null) ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return voltarComErro("Nenhum e-mail cadastrado no grupo de avisos internos.");

  const html = montarHtmlAvisoInterno(template, valores, mensagemHtml);
  const assunto = template.montarAssunto(valores);

  const { data: aviso, error: erroAviso } = await supabase
    .from("avisos_internos_historico")
    .insert({
      template_id: template.id,
      assunto,
      titulo: template.montarTitulo(valores),
      html,
      total_destinatarios: emails.length,
      criado_por: user.id,
      criado_por_email: user.email,
    })
    .select("id")
    .single();
  if (erroAviso || !aviso) return voltarComErro(erroAviso?.message ?? "Falha ao registrar o aviso.");

  const { error: erroEnvios } = await supabase.from("avisos_internos_envios").insert(emails.map((email) => ({ aviso_id: aviso.id, email })));
  if (erroEnvios) {
    await supabase.from("avisos_internos_historico").delete().eq("id", aviso.id);
    return voltarComErro(erroEnvios.message);
  }

  const resultado = await enviarPendentesDoAviso(supabase, { id: aviso.id, assunto, html });

  // Nada saiu (ex: Resend fora do ar/sem chave): não deixa um aviso
  // "fantasma" no histórico -- volta pra tela de revisão com o erro, igual
  // ao comportamento de antes.
  if (resultado.enviados === 0) {
    await supabase.from("avisos_internos_historico").delete().eq("id", aviso.id);
    return voltarComErro(resultado.primeiroErro ?? "Não foi possível enviar o aviso.");
  }

  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_MENSAGEM_AVISO);

  const pendencias = resultado.falhas + resultado.restantes;
  const aviso_ok = pendencias
    ? `Aviso enviado pra ${resultado.enviados} pessoa(s). ${pendencias} ainda não receberam -- use "Enviar para quem faltou".`
    : `Aviso enviado pra ${resultado.enviados} pessoa(s).`;
  redirect(`/campanhas/avisos-internos/enviados/${aviso.id}?ok=${encodeURIComponent(aviso_ok)}`);
}
