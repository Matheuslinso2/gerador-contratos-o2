"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isMatheus, ADMIN_EMAILS } from "@/lib/admin";

export async function excluirUsuario(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) redirect("/");

  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "");
  if (!id) redirect("/admin/usuarios?erro=ID do usuário não informado.");

  if (ADMIN_EMAILS.includes(email)) {
    redirect(`/admin/usuarios?erro=${encodeURIComponent("Não é possível excluir uma conta de administrador por aqui.")}`);
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(id);
  if (error) {
    redirect(`/admin/usuarios?erro=${encodeURIComponent(error.message)}`);
  }

  redirect(`/admin/usuarios?sucesso=${encodeURIComponent(`Login ${email} excluído.`)}`);
}
