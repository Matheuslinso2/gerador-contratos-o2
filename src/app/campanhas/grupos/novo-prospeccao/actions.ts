"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { importarContatosExcel } from "@/lib/campanhas/importarContatos";

// Grupo de prospecção (pedido do Matheus, 15/09/2026): tipo exclusivo pra
// imobiliárias SEM cadastro no Workspace, não necessariamente clientes da
// O2 -- por isso a criação já pede a planilha na hora (nome + Excel num
// passo só), em vez do fluxo padrão (criar grupo vazio, depois ir editar
// pra escolher imobiliárias reais).
export async function criarGrupoProspeccao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const nome = String(formData.get("nome") ?? "").trim();
  const arquivo = formData.get("arquivo");

  if (!nome) {
    redirect(`/campanhas/grupos/novo-prospeccao?erro=${encodeURIComponent("Dê um nome pro grupo.")}`);
  }
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    redirect(`/campanhas/grupos/novo-prospeccao?erro=${encodeURIComponent("Selecione uma planilha.")}`);
  }

  let contatos: ReturnType<typeof importarContatosExcel>;
  try {
    const buffer = Buffer.from(await (arquivo as File).arrayBuffer());
    contatos = importarContatosExcel(buffer);
  } catch (erro) {
    redirect(
      `/campanhas/grupos/novo-prospeccao?erro=${encodeURIComponent(erro instanceof Error ? erro.message : "Falha ao ler a planilha.")}`
    );
  }
  if (!contatos.length) {
    redirect(`/campanhas/grupos/novo-prospeccao?erro=${encodeURIComponent("Nenhum contato com e-mail válido encontrado na planilha.")}`);
  }

  const { data: grupo, error: erroGrupo } = await supabase
    .from("campanhas_grupos")
    .insert({ nome, tipo: "prospeccao", imobiliaria_ids: [], criado_por: user.id, criado_por_email: user.email })
    .select("id")
    .single();

  if (erroGrupo || !grupo) {
    const mensagem = erroGrupo?.code === "23505" ? "Já existe um grupo com esse nome." : (erroGrupo?.message ?? "Falha ao criar o grupo.");
    redirect(`/campanhas/grupos/novo-prospeccao?erro=${encodeURIComponent(mensagem)}`);
  }

  const { error: erroContatos } = await supabase.from("campanhas_grupos_contatos").upsert(
    contatos.map((c) => ({
      grupo_id: grupo.id,
      nome_imobiliaria: c.nomeImobiliaria,
      nome_responsavel: c.nomeResponsavel,
      email: c.email,
      cpf_cnpj: c.cpfCnpj,
    })),
    { onConflict: "grupo_id,email" }
  );
  if (erroContatos) {
    redirect(`/campanhas/grupos/${grupo.id}?erro=${encodeURIComponent(erroContatos.message)}`);
  }

  redirect(`/campanhas/grupos/${grupo.id}?ok=${encodeURIComponent(`Grupo criado com ${contatos.length} contato(s).`)}`);
}
