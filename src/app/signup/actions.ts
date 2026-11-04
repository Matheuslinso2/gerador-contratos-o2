"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { validarCnpjOuCpf } from "@/lib/validacoesBr";

// Login verificado (04/11/2026): /signup não cria mais conta nem senha. A imobiliária envia um PEDIDO DE ACESSO; a equipe O2
// avalia em /admin/imobiliarias e, se aprovar, envia o convite (e-mail com link + código) para criar a senha.
// O pedido não cria ficha nova sozinho: a aprovação liga à ficha existente pelo CNPJ (base única de imobiliárias).
export async function solicitarAcesso(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const aceiteTermos = formData.get("aceite_termos") === "on";
  const nome = String(formData.get("nome_imobiliaria") ?? "").trim();
  const cnpj = String(formData.get("cnpj_cpf") ?? "").trim();
  const endereco = String(formData.get("endereco") ?? "").trim();
  const responsavel = String(formData.get("responsavel") ?? "").trim();
  const erro = (m: string) => redirect(`/signup?erro=${encodeURIComponent(m)}`);

  if (!aceiteTermos) erro("É necessário aceitar os Termos de Uso e a Política de Privacidade.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erro("Informe um e-mail válido.");
  const faltando: string[] = [];
  if (!nome) faltando.push("Nome da imobiliária");
  if (!cnpj) faltando.push("CPF ou CNPJ");
  else if (!validarCnpjOuCpf(cnpj)) faltando.push("CPF/CNPJ válido — confira os números digitados");
  if (!endereco) faltando.push("Endereço");
  if (!responsavel) faltando.push("Nome do responsável");
  if (faltando.length > 0) erro(`Preencha os campos obrigatórios: ${faltando.join(", ")}.`);

  const sb = createServiceClient();
  // Sem duplicar pedido pendente do mesmo e-mail + CNPJ, e com limite de 3 pedidos por e-mail em 24 h (formulário é público).
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recentes } = await sb.from("imobiliaria_pedidos_acesso").select("id, cnpj, status").eq("email", email).gte("criado_em", desde);
  const jaPedido = (recentes ?? []).some((p) => p.cnpj === cnpj && p.status === "pendente");
  if (!jaPedido && (recentes ?? []).length < 3) {
    await sb.from("imobiliaria_pedidos_acesso").insert({ nome, cnpj, endereco, responsavel, email });
    await enviarEmail({
      para: "comercial@o2seguros.com.br",
      assunto: `Pedido de acesso ao Workspace: ${nome}`,
      html: `<h2>Novo pedido de acesso ao Workspace O2</h2>
        <p><strong>Imobiliária:</strong> ${esc(nome)}</p><p><strong>CNPJ/CPF:</strong> ${esc(cnpj)}</p>
        <p><strong>Responsável:</strong> ${esc(responsavel)}</p><p><strong>E-mail:</strong> ${esc(email)}</p>
        <p>Avalie em <strong>Imobiliárias cadastradas → Pedidos de acesso</strong> e, se aprovar, o convite é enviado ao e-mail informado.</p>`,
    });
  }
  // Mesma resposta em qualquer caso (não revela se já havia pedido).
  redirect(`/login?aviso=${encodeURIComponent("Pedido enviado! A O2 vai avaliar e, se aprovado, você recebe um convite no e-mail informado para criar sua senha.")}`);
}

function esc(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
