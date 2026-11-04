"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { concluirConvite, enviarCodigoDoConvite } from "@/lib/convites";

export async function pedirCodigoConvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const r = await enviarCodigoDoConvite(token);
  if (!r.ok) redirect(`/convite/${token}?erro=${encodeURIComponent(r.erro)}`);
  redirect(`/convite/${token}?enviado=1`);
}

export async function criarSenhaConvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const codigo = String(formData.get("codigo") ?? "");
  const senha = String(formData.get("senha") ?? "");
  const confirmar = String(formData.get("confirmar") ?? "");
  if (senha !== confirmar) redirect(`/convite/${token}?enviado=1&erro=${encodeURIComponent("As duas senhas não são iguais.")}`);
  const r = await concluirConvite({ token, codigo, senha });
  if (!r.ok) redirect(`/convite/${token}?enviado=1&erro=${encodeURIComponent(r.erro)}`);

  // Conta criada: já entra logado (primeiro acesso).
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: r.email, password: senha });
  if (error) redirect(`/login?aviso=${encodeURIComponent("Senha criada! Entre com seu e-mail e a senha nova.")}`);
  redirect("/");
}
