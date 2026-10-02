"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail } from "@/lib/email";
import { buscarTemplateAviso } from "@/lib/avisosInternos/templates";
import { montarHtmlAvisoInterno } from "@/lib/avisosInternos/email";
import { COOKIE_MENSAGEM_AVISO } from "@/lib/avisosInternos/cookie";

// Remetente transacional (avisos@), não o de marketing -- comunicado
// interno da RH não é campanha comercial, não precisa (nem deve ter)
// rodapé de descadastro. Todos os destinatários vão num "to" só: é a
// própria equipe O2 se comunicando, não tem problema um ver o e-mail do
// outro (diferente de campanha pra imobiliária externa).
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
  const { data: grupo } = await supabase
    .from("avisos_internos_grupos")
    .select("emails")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const emails = (grupo?.emails as string[] | null) ?? [];
  if (!emails.length) {
    redirect(
      `/campanhas/avisos-internos/revisar?${new URLSearchParams({ template: template.id, ...valores }).toString()}&erro=${encodeURIComponent("Nenhum e-mail cadastrado no grupo de avisos internos.")}`
    );
  }

  const html = montarHtmlAvisoInterno(template, valores, mensagemHtml);

  try {
    await enviarEmail({
      para: emails,
      assunto: template.montarAssunto(valores),
      html,
      remetente: "O2 Seguros",
      throwSeFalhar: true,
    });
  } catch (erro) {
    redirect(
      `/campanhas/avisos-internos/revisar?${new URLSearchParams({ template: template.id, ...valores }).toString()}&erro=${encodeURIComponent(erro instanceof Error ? erro.message : String(erro))}`
    );
  }

  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_MENSAGEM_AVISO);

  redirect("/campanhas/avisos-internos?ok=1");
}
