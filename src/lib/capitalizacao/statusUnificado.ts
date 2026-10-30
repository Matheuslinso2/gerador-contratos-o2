import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { montarResolvedorImobiliarias } from "@/lib/ramos-elementares/imobiliariasUnificadas";
import type { LinhaStatusCap } from "./painel";

// Quadro de imobiliárias do painel de Capitalização pela BASE ÚNICA de
// imobiliárias (regra fixa do Matheus, 22/10/2026): cada nome/empresa do card
// vai para a ficha com vínculo confirmado; fichas de um grupo "mesma_empresa"
// somam numa linha só. Sem vínculo: fica com o nome do card e a marca
// semVinculo, para revisão em /admin/imobiliarias -- nunca vira imobiliária
// nova sozinho.
export type LinhaStatusCapUnificada = LinhaStatusCap & { semVinculo?: boolean };

export async function unificarStatusImobiliariasCap(supabase: SupabaseClient, linhas: LinhaStatusCap[]): Promise<LinhaStatusCapUnificada[]> {
  const resolvedor = await montarResolvedorImobiliarias(supabase);
  const juntas = new Map<string, LinhaStatusCapUnificada>();
  for (const l of linhas) {
    const destino = resolvedor.porChave(l.chave, l.nome);
    const atual = juntas.get(destino.chave);
    if (!atual) {
      juntas.set(destino.chave, { ...l, chave: destino.chave, nome: destino.nome, semVinculo: destino.semVinculo || undefined });
      continue;
    }
    atual.solicitacoes += l.solicitacoes;
    atual.emAndamento += l.emAndamento;
    atual.naoPagas += l.naoPagas;
    atual.fechadas += l.fechadas;
    atual.premioSolicitado += l.premioSolicitado;
    atual.premioFechado += l.premioFechado;
    atual.comissaoFechada += l.comissaoFechada;
    atual.solicitacoesMesAnterior += l.solicitacoesMesAnterior;
  }
  return [...juntas.values()].sort((a, b) => b.solicitacoes - a.solicitacoes || a.nome.localeCompare(b.nome, "pt-BR"));
}
