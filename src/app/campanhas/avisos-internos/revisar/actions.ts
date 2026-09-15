"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail } from "@/lib/email";
import { buscarTemplateAviso } from "@/lib/avisosInternos/templates";
import { montarHtmlAvisoInterno } from "@/lib/avisosInternos/email";

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
  const mensagem = String(formData.get("mensagem") ?? "").trim();

  const camposFaltando = template.campos.filter((c) => c.obrigatorio && !valores[c.key]);
  if (camposFaltando.length) {
    redirect(`/campanhas/avisos-internos/novo?template=${template.id}&erro=${encodeURIComponent("Preencha todos os campos obrigatórios.")}`);
  }

  const { data: grupo } = await supabase
    .from("avisos_internos_grupos")
    .select("emails")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const emails = (grupo?.emails as string[] | null) ?? [];
  if (!emails.length) {
    redirect(
      `/campanhas/avisos-internos/revisar?${new URLSearchParams({ template: template.id, mensagem, ...valores }).toString()}&erro=${encodeURIComponent("Nenhum e-mail cadastrado no grupo de avisos internos.")}`
    );
  }

  const html = montarHtmlAvisoInterno(template, valores, mensagem);

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
      `/campanhas/avisos-internos/revisar?${new URLSearchParams({ template: template.id, mensagem, ...valores }).toString()}&erro=${encodeURIComponent(erro instanceof Error ? erro.message : String(erro))}`
    );
  }

  redirect("/campanhas/avisos-internos?ok=1");
}
