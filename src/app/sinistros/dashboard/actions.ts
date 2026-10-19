"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// "Atualizar base" do dashboard: refaz as tabelas mensais (~16 s). Roda com
// a chave de serviço porque o limite de tempo de consulta do usuário logado
// (8 s no Supabase) não comporta a montagem; a permissão é checada aqui antes.
export async function atualizarBaseSinistros(fd: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(isAdmin(user.email) || isColaboradorO2(user.email))) redirect("/sinistros/gestao");
  const volta = String(fd.get("volta") ?? "");
  const { error } = await createServiceClient().rpc("atualizar_base_kpis_sinistros");
  const q = new URLSearchParams(volta);
  if (error) q.set("erro", `Não foi possível atualizar a base: ${error.message}`);
  redirect(`/sinistros?${q.toString()}`);
}
