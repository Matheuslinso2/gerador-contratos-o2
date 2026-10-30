"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { traduzirErroAuth } from "@/lib/authErrors";
import { origem } from "@/lib/origem";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?erro=${encodeURIComponent(traduzirErroAuth(error.message))}`);
  }
  redirect("/");
}

// Login sem senha (decisão de 30/10/2026): equipe O2 entra com a conta Google
// do Workspace; imobiliárias e demais entram com código de 6 números enviado
// por e-mail. Senha continua valendo. Nenhum dos dois cria conta nova -- quem
// não tem cadastro continua passando por /signup (ver login/callback).

export async function entrarComGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origem()}/login/callback`, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) {
    redirect(`/login?erro=${encodeURIComponent("Não foi possível abrir o login do Google. Tente de novo.")}`);
  }
  redirect(data.url);
}

const COOKIE_EMAIL_CODIGO = "o2_login_codigo_email";

export async function enviarCodigo(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect(`/login/codigo?erro=${encodeURIComponent("Informe seu e-mail.")}`);

  const supabase = await createClient();
  // shouldCreateUser: false -- código só para quem já tem conta. Mesma
  // resposta exista ou não o e-mail, pra não confirmar contas a quem testa.
  await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });

  // E-mail fica num cookie curto (não na URL) até a pessoa digitar o código.
  (await cookies()).set(COOKIE_EMAIL_CODIGO, email, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 15 * 60, path: "/login" });
  redirect("/login/codigo?enviado=1");
}

export async function confirmarCodigo(formData: FormData) {
  const token = String(formData.get("codigo") ?? "").replace(/\D/g, "");
  const loja = await cookies();
  const email = loja.get(COOKIE_EMAIL_CODIGO)?.value;
  if (!email) redirect(`/login/codigo?erro=${encodeURIComponent("O tempo para digitar o código acabou. Peça um novo código.")}`);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    redirect(`/login/codigo?enviado=1&erro=${encodeURIComponent("Código inválido ou vencido. Confira o e-mail ou peça um novo código.")}`);
  }
  loja.delete({ name: COOKIE_EMAIL_CODIGO, path: "/login" });
  redirect("/");
}

export async function esqueciSenha(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    redirect(`/esqueci-senha?erro=${encodeURIComponent("Informe seu e-mail.")}`);
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origem()}/redefinir-senha`,
  });

  // Sempre a mesma mensagem, exista ou não o e-mail cadastrado — evita confirmar
  // pra quem está tentando adivinhar e-mails de contas existentes.
  redirect(
    `/login?aviso=${encodeURIComponent(
      "Se esse e-mail estiver cadastrado, enviamos um link para redefinir a senha."
    )}`
  );
}
