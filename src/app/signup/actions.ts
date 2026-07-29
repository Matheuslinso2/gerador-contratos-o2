"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traduzirErroAuth } from "@/lib/authErrors";
import { origem } from "@/lib/origem";

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const aceiteTermos = formData.get("aceite_termos") === "on";

  if (!aceiteTermos) {
    redirect(`/signup?erro=${encodeURIComponent("É necessário aceitar os Termos de Uso e a Política de Privacidade.")}`);
  }

  if (password.length < 6) {
    redirect(`/signup?erro=${encodeURIComponent("A senha precisa ter pelo menos 6 caracteres.")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await origem()}/`,
      data: {
        termos_aceitos_em: new Date().toISOString(),
      },
    },
  });
  if (error) {
    redirect(`/signup?erro=${encodeURIComponent(traduzirErroAuth(error.message))}`);
  }

  if (!data.session) {
    redirect("/login?aviso=Conta criada! Confirme seu e-mail antes de entrar.");
  }
  redirect("/");
}
