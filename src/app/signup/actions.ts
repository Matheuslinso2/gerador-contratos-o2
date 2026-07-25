"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traduzirErroAuth } from "@/lib/authErrors";

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (password.length < 6) {
    redirect(`/signup?erro=${encodeURIComponent("A senha precisa ter pelo menos 6 caracteres.")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    redirect(`/signup?erro=${encodeURIComponent(traduzirErroAuth(error.message))}`);
  }

  if (!data.session) {
    redirect("/login?aviso=Conta criada! Confirme seu e-mail antes de entrar.");
  }
  redirect("/");
}
