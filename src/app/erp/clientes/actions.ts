"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { digitos, tipoDoDocumento, validarCadastro } from "@/lib/erp/clientes";

// ERP O2 — cadastro de clientes (27/10/2026). A tabela locatarios só tem leitura para a equipe (RLS); a gravação passa pelo servidor,
// depois de conferir que quem chama é da equipe O2. Regras: CPF/CNPJ válido sempre; e-mail ou telefone sempre; CPF/CNPJ já cadastrado
// não cria outro cliente, leva para a ficha existente (unificação sem duplicar).
async function equipe() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");
  return user!.email as string;
}

const campo = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const volta = (caminho: string, erros: string[]) => redirect(`${caminho}?erro=${encodeURIComponent(erros.join(" | "))}`);

export async function criarCliente(formData: FormData) {
  await equipe();
  const dados = { nome: campo(formData, "nome"), documento: campo(formData, "documento"), email: campo(formData, "email"), telefone: campo(formData, "telefone") };
  const erros = validarCadastro(dados);
  if (erros.length) volta("/erp/clientes/novo", erros);
  const sb = createServiceClient();
  const cpf = digitos(dados.documento);
  const { data: existente } = await sb.from("locatarios").select("id").eq("cpf", cpf).maybeSingle();
  if (existente) redirect(`/erp/clientes/${existente.id}?aviso=ja_existia`);
  const { data: novo, error } = await sb
    .from("locatarios")
    .insert({
      cpf, nome: dados.nome, nome_normalizado: dados.nome.toUpperCase(), tipo_documento: tipoDoDocumento(dados.documento),
      email: dados.email || null, telefone: digitos(dados.telefone) || null, primeira_fonte: "erp_cadastro_manual",
    })
    .select("id")
    .single();
  if (error) volta("/erp/clientes/novo", [`Não consegui gravar: ${error.message}`]);
  revalidatePath("/erp/clientes");
  redirect(`/erp/clientes/${novo!.id}?aviso=criado`);
}

/** Completa/edita um cliente. CPF/CNPJ não muda aqui (é a chave do cadastro); nome, e-mail e telefone sim. O contato antigo fica em contatos_anteriores. */
export async function atualizarCliente(formData: FormData) {
  const email = await equipe();
  const id = campo(formData, "id");
  const caminho = `/erp/clientes/${id}`;
  const sb = createServiceClient();
  const { data: atual } = await sb.from("locatarios").select("id, cpf, nome, email, telefone, contatos_anteriores").eq("id", id).maybeSingle();
  if (!atual) redirect("/erp/clientes");
  // CPF/CNPJ válido é a chave do cadastro e não muda; se está faltando ou inválido, esta tela permite informar/corrigir
  const documentoAtualValido = !!tipoDoDocumento(atual!.cpf);
  const dados = { nome: campo(formData, "nome"), documento: documentoAtualValido ? (atual!.cpf as string) : campo(formData, "documento"), email: campo(formData, "email"), telefone: campo(formData, "telefone") };
  const erros = validarCadastro(dados);
  if (erros.length) volta(caminho, erros);
  if (!documentoAtualValido) {
    // outro cliente já tem esse CPF/CNPJ: não cria duplicidade; a unificação dos dois cadastros é decisão da equipe
    const { data: outro } = await sb.from("locatarios").select("id, codigo_cliente").eq("cpf", digitos(dados.documento)).neq("id", id).maybeSingle();
    if (outro) volta(caminho, [`Esse CPF/CNPJ já pertence ao cliente CLI-${String(outro.codigo_cliente).padStart(6, "0")}. Unifique os dois cadastros em vez de repetir o documento.`]);
  }
  const mudouContato = (atual!.email ?? "") !== dados.email || (atual!.telefone ?? "") !== digitos(dados.telefone);
  const anteriores = Array.isArray(atual!.contatos_anteriores) ? atual!.contatos_anteriores : [];
  const patch: Record<string, unknown> = {
    nome: dados.nome, nome_normalizado: dados.nome.toUpperCase(), email: dados.email || null, telefone: digitos(dados.telefone) || null, updated_at: new Date().toISOString(),
  };
  if (!documentoAtualValido) { patch.cpf = digitos(dados.documento); patch.tipo_documento = tipoDoDocumento(dados.documento); patch.identificacao = "documento"; }
  if (mudouContato && (atual!.email || atual!.telefone)) patch.contatos_anteriores = [...anteriores, { email: atual!.email, telefone: atual!.telefone, ate: new Date().toISOString(), por: email }];
  const { error } = await sb.from("locatarios").update(patch).eq("id", id);
  if (error) volta(caminho, [`Não consegui gravar: ${error.message}`]);
  revalidatePath(caminho);
  revalidatePath("/erp/clientes");
  redirect(`${caminho}?aviso=salvo`);
}
