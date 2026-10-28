import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Datasets } from "./construir";
import { calcularDatasetsAoVivo } from "./leitura";

// Retrato compartilhado dos datasets (SEM filtro de perfil: a comissão
// individual só é removida em acesso.ts, a cada resposta). Por isso este
// retrato nunca é devolvido direto ao navegador nem entra em cache de CDN.

export const IDADE_MAXIMA_MS = 10 * 60 * 1000;

export type Retrato = { dados: Datasets; geradoEm: string };

let emAndamento: Promise<Retrato> | null = null;

export async function atualizarRetrato(): Promise<Retrato> {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    try {
      const dados = await calcularDatasetsAoVivo();
      const geradoEm = new Date().toISOString();
      const { error } = await createServiceClient().from("painel_comercial_snapshot").upsert({ id: 1, gerado_em: geradoEm, dados });
      if (error) console.error("Não consegui gravar o retrato do Painel Comercial:", error.message);
      return { dados, geradoEm };
    } finally {
      emAndamento = null;
    }
  })();
  return emAndamento;
}

export async function obterRetrato(forcar = false): Promise<Retrato> {
  if (!forcar) {
    const { data } = await createServiceClient().from("painel_comercial_snapshot").select("gerado_em, dados").eq("id", 1).maybeSingle();
    if (data && Date.now() - new Date(data.gerado_em as string).getTime() < IDADE_MAXIMA_MS) {
      return { dados: data.dados as Datasets, geradoEm: data.gerado_em as string };
    }
    // Retrato velho: serve se o Bitrix falhar, mas tenta atualizar primeiro.
    try {
      return await atualizarRetrato();
    } catch (e) {
      if (data) return { dados: data.dados as Datasets, geradoEm: data.gerado_em as string };
      throw e;
    }
  }
  return atualizarRetrato();
}
