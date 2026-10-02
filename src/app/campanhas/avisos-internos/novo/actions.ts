"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { buscarTemplateAviso } from "@/lib/avisosInternos/templates";
import { COOKIE_MENSAGEM_AVISO } from "@/lib/avisosInternos/cookie";

// Pedido do Matheus, 01/10/2026: suporte a imagem no recado de Avisos
// Internos (reaproveita o EditorCorpo de Campanhas) -- o recado passou a
// poder ficar grande (texto + imagem), grande demais pra viajar inteiro
// numa query string como antes (`novo` -> `revisar` era um <form method=
// "get">, e o reenvio em caso de erro em revisar/actions.ts também
// montava a URL de novo com o mensagem embutido). Guarda o HTML do recado
// num cookie de curta duração em vez disso -- só esse campo, os outros
// (nome/data/etc.) continuam curtos o bastante pra ir pela URL sem risco.

export async function prepararRevisaoAviso(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const templateId = String(formData.get("template") ?? "");
  const template = buscarTemplateAviso(templateId);
  if (!template) redirect("/campanhas/avisos-internos");

  const valores: Record<string, string> = Object.fromEntries(
    template.campos.map((c) => [c.key, String(formData.get(c.key) ?? "").trim()])
  );
  const mensagemHtml = String(formData.get("mensagem_html") ?? "").trim();

  const camposFaltando = template.campos.filter((c) => c.obrigatorio && !valores[c.key]);
  if (camposFaltando.length) {
    redirect(`/campanhas/avisos-internos/novo?template=${template.id}&erro=${encodeURIComponent("Preencha todos os campos obrigatórios.")}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_MENSAGEM_AVISO, mensagemHtml, {
    httpOnly: true,
    maxAge: 60 * 15,
    path: "/campanhas/avisos-internos",
  });

  redirect(`/campanhas/avisos-internos/revisar?${new URLSearchParams({ template: template.id, ...valores }).toString()}`);
}
