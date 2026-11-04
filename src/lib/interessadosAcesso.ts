import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";

// Acesso só por convite (04/11/2026): quando alguém SEM acesso tenta entrar (ou deixa o contato em /signup), a O2 é avisada e o
// comercial atende, levanta os dados da imobiliária e só então envia o convite pela ficha. Aqui só se registra o interessado
// (tabela imobiliaria_pedidos_acesso) e se avisa comercial@ -- nunca cria conta nem ficha.

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LIMITE_POR_HORA = 20; // formulário e login são públicos: freia disparo em massa de avisos

export async function registrarInteressado(d: { email: string; origem: "login" | "signup"; nome?: string; responsavel?: string; telefone?: string }) {
  try {
    const email = d.email.trim().toLowerCase();
    if (!EMAIL_OK.test(email) || email.length > 200) return;
    const sb = createServiceClient();
    const { data: tem } = await sb.rpc("email_tem_conta", { p_email: email });
    if (tem) return; // já tem conta: não é interessado novo
    const { data: aberto } = await sb.from("imobiliaria_pedidos_acesso").select("id").eq("email", email).eq("status", "pendente").limit(1);
    if (aberto && aberto.length > 0) return;
    const { count } = await sb
      .from("imobiliaria_pedidos_acesso")
      .select("id", { count: "exact", head: true })
      .gte("criado_em", new Date(Date.now() - 3600 * 1000).toISOString());
    if ((count ?? 0) >= LIMITE_POR_HORA) return;

    await sb.from("imobiliaria_pedidos_acesso").insert({
      email,
      origem: d.origem,
      nome: d.nome?.trim().slice(0, 200) || null,
      endereco: null,
      responsavel: d.responsavel?.trim().slice(0, 200) || null,
      telefone: d.telefone?.trim().slice(0, 40) || null,
    });
    await enviarEmail({
      para: "comercial@o2seguros.com.br",
      assunto: `Imobiliária sem acesso tentou entrar no Workspace: ${email}`,
      html: `<h2>Alguém sem acesso procurou o Workspace O2</h2>
        <p><strong>E-mail:</strong> ${esc(email)}</p>
        ${d.nome ? `<p><strong>Imobiliária:</strong> ${esc(d.nome)}</p>` : ""}
        ${d.responsavel ? `<p><strong>Responsável:</strong> ${esc(d.responsavel)}</p>` : ""}
        ${d.telefone ? `<p><strong>Telefone:</strong> ${esc(d.telefone)}</p>` : ""}
        <p><strong>Como chegou:</strong> ${d.origem === "login" ? "tentou entrar na tela de login" : "deixou o contato em /signup"}</p>
        <p>O atendimento é do comercial: levantar os dados da imobiliária, cadastrar a ficha e enviar o convite (Imobiliárias cadastradas → ficha → Convite de acesso). Os interessados ficam em <em>Imobiliárias cadastradas → Pedidos de acesso</em>.</p>`,
    });
  } catch (e) {
    console.error("[interessadosAcesso] falhou", e); // nunca atrapalha o login
  }
}
