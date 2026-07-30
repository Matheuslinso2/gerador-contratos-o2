"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { sincronizarPlanilhas, type ResultadoSincronizacao } from "@/lib/prospeccaoSync";

// Processa só um lote (ver LIMITE_ARQUIVOS_POR_EXECUCAO em prospeccaoSync.ts)
// e devolve o resultado direto pro cliente — sem redirect — pra
// BotaoSincronizar.tsx poder chamar de novo em loop até não sobrar nada,
// sem estourar o limite de 60s do servidor numa chamada só.
export async function sincronizarPasso(forcarTudo: boolean): Promise<ResultadoSincronizacao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const resultado = await sincronizarPlanilhas(supabase, forcarTudo);
  if (resultado.erros.length) {
    console.error("[prospeccao][sync] erros:", resultado.erros);
  }
  return resultado;
}
