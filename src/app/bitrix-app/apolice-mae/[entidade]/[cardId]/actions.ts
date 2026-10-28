"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { validarPasseCard } from "@/lib/bitrix/sessaoPanorama";
import { chavePasseApoliceMae, funilDaEntidade, lerCardEndosso, vincularApoliceMae } from "@/lib/bitrix/apoliceMae";

// Vincular a apólice escolhida ao card de endosso (aba Apólice-mãe, 28/10/2026).
// Sem login do Workspace dentro do Bitrix: o passe (?p=) é a autorização.
export async function vincular(entidade: number, cardId: number, passe: string, apoliceId: string): Promise<{ ok: true; numero: string; endossoNoErp: boolean } | { ok: false; erro: string }> {
  const funil = funilDaEntidade(entidade);
  const email = funil ? validarPasseCard(passe, chavePasseApoliceMae(entidade, cardId)) : null;
  if (!funil || !email) return { ok: false, erro: "Sessão expirada. Feche e abra de novo a aba Apólice-mãe do card." };
  const sb = createServiceClient();
  try {
    const card = await lerCardEndosso(sb, funil, cardId);
    if (!card.ehEndosso) return { ok: false, erro: "Este card não está num funil de endosso." };
    const r = await vincularApoliceMae(sb, { funil, cardId, apoliceId, email });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Não consegui vincular." };
  }
}
