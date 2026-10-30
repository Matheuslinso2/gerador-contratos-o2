"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { emailAutorizado } from "@/lib/mcp/conectorLeitura";

export async function decidirAutorizacao(formData: FormData) {
  const id = String(formData.get("authorization_id") ?? "");
  const negar = formData.get("decisao") === "negar";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !id) redirect("/login");

  const email = (user.email ?? "").toLowerCase();
  const autorizado = (isAdmin(email) || isColaboradorO2(email)) && (await emailAutorizado(email));

  const { data, error } =
    negar || !autorizado
      ? await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}`);
  redirect(data.redirect_url);
}
