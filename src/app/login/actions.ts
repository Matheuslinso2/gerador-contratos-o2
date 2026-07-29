"use server";

import { redirect } from "next/navigation";
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
