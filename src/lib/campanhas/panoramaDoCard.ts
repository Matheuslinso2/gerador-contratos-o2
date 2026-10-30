import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DadosPanorama } from "./panoramaCampanha";

// Dados da aba "Panorama da campanha" no card do Bitrix (30/10/2026): a ligação
// card ↔ imobiliária ↔ campanha, as parciais já enviadas (versões gravadas em
// campanhas_panoramas) e as anotações da equipe. A posição "de hoje" vem do
// retrato do Painel Comercial (ver desempenhoNoCard.ts).

export const chavePasseCampanha = (cardId: number) => `campanha:${cardId}`;

export type VersaoEnviada = { id: string; versao: number; token: string; enviadoEm: string | null; dados: DadosPanorama };

export type PanoramaDoCard = {
  campanhaId: string;
  campanhaNome: string;
  inicio: string | null;
  fim: string | null;
  imobiliariaId: string;
  imobiliariaNome: string;
  origem: "vinculado" | "criado";
  proximaAcao: string | null;
  observacao: string | null;
  atualizadoPor: string | null;
  atualizadoEm: string | null;
  versoes: VersaoEnviada[]; // mais antiga primeiro
};

/** null = o card não está ligado a nenhuma campanha do Workspace. */
export async function lerPanoramaDoCard(db: SupabaseClient, dealId: number): Promise<PanoramaDoCard | null> {
  const { data: lig } = await db
    .from("campanhas_cards_bitrix")
    .select("campanha_id, imobiliaria_id, origem, proxima_acao, observacao, atualizado_por, atualizado_em")
    .eq("bitrix_deal_id", dealId)
    .maybeSingle();
  if (!lig) return null;
  const [{ data: campanha }, { data: imob }, { data: versoes }] = await Promise.all([
    db.from("campanhas").select("nome, valido_de, valido_ate").eq("id", lig.campanha_id).maybeSingle(),
    db.from("imobiliarias").select("nome").eq("id", lig.imobiliaria_id).maybeSingle(),
    db
      .from("campanhas_panoramas")
      .select("id, versao, token, enviado_em, dados")
      .eq("campanha_id", lig.campanha_id)
      .eq("status", "enviada")
      .contains("imobiliaria_ids", [lig.imobiliaria_id])
      .order("versao", { ascending: true }),
  ]);
  return {
    campanhaId: lig.campanha_id,
    campanhaNome: campanha?.nome ?? "Campanha",
    inicio: campanha?.valido_de ?? null,
    fim: campanha?.valido_ate ?? null,
    imobiliariaId: lig.imobiliaria_id,
    imobiliariaNome: imob?.nome ?? "Imobiliária",
    origem: lig.origem,
    proximaAcao: lig.proxima_acao,
    observacao: lig.observacao,
    atualizadoPor: lig.atualizado_por,
    atualizadoEm: lig.atualizado_em,
    versoes: ((versoes ?? []) as { id: string; versao: number; token: string; enviado_em: string | null; dados: DadosPanorama }[]).map((v) => ({
      id: v.id,
      versao: v.versao,
      token: v.token,
      enviadoEm: v.enviado_em,
      dados: v.dados,
    })),
  };
}
