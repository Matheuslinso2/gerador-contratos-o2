"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { validarPasseCard } from "@/lib/bitrix/sessaoPanorama";
import { chavePasseCampanha } from "@/lib/campanhas/panoramaDoCard";

// Anotações da equipe na aba "Panorama da campanha" (30/10/2026). Sem login do
// Workspace dentro do Bitrix: o passe (?p=) emitido ao abrir a aba é a autorização.
export async function salvarAcompanhamento(
  cardId: number,
  passe: string,
  dados: { proximaAcao: string; observacao: string }
): Promise<{ ok: true; por: string; em: string } | { ok: false; erro: string }> {
  const email = validarPasseCard(passe, chavePasseCampanha(cardId));
  if (!email) return { ok: false, erro: "Sessão expirada. Feche e abra de novo a aba Panorama da campanha do card." };
  const proxima = dados.proximaAcao.trim().slice(0, 300);
  const obs = dados.observacao.trim().slice(0, 2000);
  const em = new Date().toISOString();
  const { data, error } = await createServiceClient()
    .from("campanhas_cards_bitrix")
    .update({ proxima_acao: proxima || null, observacao: obs || null, atualizado_por: email, atualizado_em: em })
    .eq("bitrix_deal_id", cardId)
    .select("id");
  if (error) return { ok: false, erro: "Não consegui salvar. Tente de novo." };
  if (!data?.length) return { ok: false, erro: "Este card não está ligado a uma campanha." };
  return { ok: true, por: email, em };
}
