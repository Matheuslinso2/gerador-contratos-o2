"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { importarContatosExcel } from "@/lib/campanhas/importarContatos";

// Contatos de prospecção (item 8 da reunião de 15/09/2026): imobiliárias
// SEM cadastro no Workspace, por isso vivem em campanhas_grupos_contatos
// (não na tabela imobiliarias, que é só base de cliente real) -- ver
// supabase/schema_campanhas_grupos_contatos.sql.
export async function importarContatosGrupo(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const grupoId = String(formData.get("grupo_id") ?? "");
  const arquivo = formData.get("arquivo");

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    redirect(`/campanhas/grupos/${grupoId}?erro=${encodeURIComponent("Selecione uma planilha.")}`);
  }

  let contatos: ReturnType<typeof importarContatosExcel>;
  try {
    const buffer = Buffer.from(await (arquivo as File).arrayBuffer());
    contatos = importarContatosExcel(buffer);
  } catch (erro) {
    redirect(`/campanhas/grupos/${grupoId}?erro=${encodeURIComponent(erro instanceof Error ? erro.message : "Falha ao ler a planilha.")}`);
  }

  if (!contatos.length) {
    redirect(`/campanhas/grupos/${grupoId}?erro=${encodeURIComponent("Nenhum contato com e-mail válido encontrado na planilha.")}`);
  }

  const { error } = await supabase
    .from("campanhas_grupos_contatos")
    .upsert(
      contatos.map((c) => ({ grupo_id: grupoId, nome: c.nome, email: c.email, cpf_cnpj: c.cpf_cnpj })),
      { onConflict: "grupo_id,email" }
    );

  if (error) {
    redirect(`/campanhas/grupos/${grupoId}?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`/campanhas/grupos/${grupoId}?ok=${encodeURIComponent(`${contatos.length} contato(s) importado(s).`)}`);
}

export async function removerContatoGrupo(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const grupoId = String(formData.get("grupo_id") ?? "");
  const contatoId = String(formData.get("contato_id") ?? "");
  await supabase.from("campanhas_grupos_contatos").delete().eq("id", contatoId);
  redirect(`/campanhas/grupos/${grupoId}`);
}
