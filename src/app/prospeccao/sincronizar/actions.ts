"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { sincronizarPlanilhas, type ResultadoSincronizacao } from "@/lib/prospeccaoSync";
import { recalcularEstatisticas, recalcularMetricasImobiliarias } from "@/lib/prospeccaoEstatisticas";
import { alertarAdmin } from "@/lib/email";

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
    await alertarAdmin({
      contexto: "Sincronização de planilhas (Prospecção)",
      detalhe: resultado.erros.join("\n"),
    });
  }
  return resultado;
}

// Recalcula só as estatísticas prontas (bairro/região/cidade x faixa) a
// partir do que já está no cache local — não toca no Google Sheets, então é
// rápido mesmo com milhares de linhas. Útil depois de corrigir um bug na
// lógica de agregação, sem precisar reler as planilhas do zero.
export async function recalcularEstatisticasAction(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const total = await recalcularEstatisticas(supabase);
  await recalcularMetricasImobiliarias(supabase);
  return total;
}
